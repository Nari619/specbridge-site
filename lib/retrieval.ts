/**
 * BM25 retrieval over the tool registry — the deterministic `search_registry`
 * tool for the orchestrator. No LLM, no external index infra: builds a BM25
 * index over the in-memory 100-tool registry per PRD and ranks candidates for a
 * requirement.
 *
 * The tokenizer (stopwords → alias map → Porter stemmer) and BM25 params are
 * LOCKED by eval/retrieval-check.ts (Step 0): on the 8-PRD dataset this reaches
 * hit-rate@6 = 100% (49/49), 43/49 at rank #1, zero semantic misses — which is
 * why the backend is BM25, not embeddings. See that file for the full evidence
 * and the alias-map rationale (the Porter y→i artifact). Keep this tokenizer in
 * lockstep with the checker; re-run Step 0 after any change to it.
 */
import type { RegistryTool } from "@/lib/registry-source";

const K1 = 1.5;
const B = 0.75;

const STOP = new Set([
  "a","an","the","of","for","and","or","to","in","on","by","with","from","as","is","are","be",
  "this","that","these","those","it","its","at","all","each","every","must","should","we","our",
]);

// Curated alias map — normalize verb forms to their noun form BEFORE stemming.
// WHY: the Porter stemmer's step 1c maps trailing "y"→"i" ("notify"→"notifi")
// while the derived noun stems without it ("notification"→"notif"), so the two
// forms miss by one character and BM25 scores them as unrelated. Each entry is a
// verb↔noun pair where both forms plausibly appear in banking PRDs and tool
// descriptions. Tight, auditable, evidence-driven — grow only on a real miss
// surfaced by Step 0. (notification_dispatcher has empty tags, so a retrieval
// miss there would mis-status a matched-and-risky capability as missing; this
// map protects gate accuracy, not just precision.)
const ALIASES: Record<string, string> = {
  notify: "notification",
  verify: "verification",
  authorize: "authorization",
  disburse: "disbursement",
};

// Classic Porter stemmer (Martin Porter's algorithm, standard JS port).
function porterStem(w: string): string {
  const step2list: Record<string, string> = { ational:"ate",tional:"tion",enci:"ence",anci:"ance",izer:"ize",bli:"ble",alli:"al",entli:"ent",eli:"e",ousli:"ous",ization:"ize",ation:"ate",ator:"ate",alism:"al",iveness:"ive",fulness:"ful",ousness:"ous",aliti:"al",iviti:"ive",biliti:"ble",logi:"log" };
  const step3list: Record<string, string> = { icate:"ic",ative:"",alize:"al",iciti:"ic",ical:"ic",ful:"",ness:"" };
  const c = "[^aeiou]", v = "[aeiouy]", C = c + "[^aeiouy]*", V = v + "[aeiou]*";
  const mgr0 = "^(" + C + ")?" + V + C;
  const meq1 = "^(" + C + ")?" + V + C + "(" + V + ")?$";
  const mgr1 = "^(" + C + ")?" + V + C + V + C;
  const s_v = "^(" + C + ")?" + v;
  if (w.length < 3) return w;
  let stem: string, suffix: string, fp: RegExpExecArray | null;
  const firstch = w.substr(0, 1);
  if (firstch === "y") w = firstch.toUpperCase() + w.substr(1);
  let re: RegExp, re2: RegExp, re3: RegExp, re4: RegExp;
  re = /^(.+?)(ss|i)es$/; re2 = /^(.+?)([^s])s$/;
  if (re.test(w)) w = w.replace(re, "$1$2");
  else if (re2.test(w)) w = w.replace(re2, "$1$2");
  re = /^(.+?)eed$/; re2 = /^(.+?)(ed|ing)$/;
  if (re.test(w)) { fp = re.exec(w); re = new RegExp(mgr0); if (fp && re.test(fp[1])) { re = /.$/; w = w.replace(re, ""); } }
  else if (re2.test(w)) {
    fp = re2.exec(w); stem = fp![1]; re2 = new RegExp(s_v);
    if (re2.test(stem)) {
      w = stem; re2 = /(at|bl|iz)$/; re3 = new RegExp("([^aeiouylsz])\\1$"); re4 = new RegExp("^" + C + v + "[^aeiouwxy]$");
      if (re2.test(w)) w = w + "e";
      else if (re3.test(w)) { re = /.$/; w = w.replace(re, ""); }
      else if (re4.test(w)) w = w + "e";
    }
  }
  re = /^(.+?)y$/;
  if (re.test(w)) { fp = re.exec(w); stem = fp![1]; re = new RegExp(s_v); if (re.test(stem)) w = stem + "i"; }
  re = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
  if (re.test(w)) { fp = re.exec(w); stem = fp![1]; suffix = fp![2]; re = new RegExp(mgr0); if (re.test(stem)) w = stem + step2list[suffix]; }
  re = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
  if (re.test(w)) { fp = re.exec(w); stem = fp![1]; suffix = fp![2]; re = new RegExp(mgr0); if (re.test(stem)) w = stem + step3list[suffix]; }
  re = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/; re2 = /^(.+?)(s|t)(ion)$/;
  if (re.test(w)) { fp = re.exec(w); stem = fp![1]; re = new RegExp(mgr1); if (re.test(stem)) w = stem; }
  else if (re2.test(w)) { fp = re2.exec(w); stem = fp![1] + fp![2]; re2 = new RegExp(mgr1); if (re2.test(stem)) w = stem; }
  re = /^(.+?)e$/;
  if (re.test(w)) { fp = re.exec(w); stem = fp![1]; re = new RegExp(mgr1); re2 = new RegExp(meq1); re3 = new RegExp("^" + C + v + "[^aeiouwxy]$"); if (re.test(stem) || (re2.test(stem) && !re3.test(stem))) w = stem; }
  re = /ll$/; re2 = new RegExp(mgr1);
  if (re.test(w) && re2.test(w)) { re = /.$/; w = w.replace(re, ""); }
  if (firstch === "y") w = firstch.toLowerCase() + w.substr(1);
  return w;
}

function normalizeToken(w: string): string {
  return porterStem(ALIASES[w] ?? w);
}

/** Locked tokenizer: lowercase → split → stopword → alias map → Porter stem. */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(normalizeToken);
}

export type Candidate = {
  tool_id: string; // registry tool name (the id used everywhere else)
  name: string;
  category: string | null;
  description_snippet: string;
  relevance: number;
};

export type RegistryIndex = {
  search(requirement: string, k?: number): Candidate[];
};

/** Build a BM25 index over the registry once; reuse across a PRD's requirements. */
export function createRegistryIndex(tools: RegistryTool[]): RegistryIndex {
  const docs = tools.map((t) =>
    tokenize(`${t.name} ${t.description} ${t.category ?? ""}`),
  );
  const N = docs.length;
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const avgdl = N > 0 ? docs.reduce((s, d) => s + d.length, 0) / N : 0;
  const idf = (term: string) => {
    const n = df.get(term) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };
  // Precompute per-doc term frequencies.
  const tfs = docs.map((doc) => {
    const tf = new Map<string, number>();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { tf, len: doc.length };
  });

  return {
    search(requirement: string, k = 6): Candidate[] {
      const qterms = [...new Set(tokenize(requirement))];
      const scored = tools.map((tool, i) => {
        const { tf, len } = tfs[i];
        let score = 0;
        for (const t of qterms) {
          const f = tf.get(t) ?? 0;
          if (f === 0) continue;
          score +=
            idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * len) / avgdl)));
        }
        return { tool, score, i };
      });
      return scored
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .slice(0, k)
        .map(({ tool, score }) => ({
          tool_id: tool.name,
          name: tool.name,
          category: tool.category,
          description_snippet: (tool.description ?? "").slice(0, 160),
          relevance: Number(score.toFixed(3)),
        }));
    },
  };
}
