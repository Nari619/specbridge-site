/**
 * Phase 1, Step 0 — offline retrieval hit-rate@k for BM25 search_registry.
 *
 * FREE and deterministic: no Claude calls. For every labeled expected_tool
 * across all dataset PRDs, checks whether BM25 (over name + description +
 * category) ranks it in the top-k. Reports hit-rate@3/@6/@10 and lists every
 * miss with the tool's actual rank/score — the diagnostic that distinguishes
 * "ranked #8" (recoverable by widening k) from "no term overlap" (BM25 can't
 * find it, evidence for embeddings).
 *
 * The BM25 here is written to the Phase 1 spec (corpus = name+description+
 * category; k1=1.5, b=0.75; lowercase / split-on-nonalphanumeric / stopword
 * tokenization) so it lifts directly into lib/retrieval.ts when we build.
 *
 * Query proxy: the labeled `capability` text stands in for the decomposed
 * requirement. Real requirements come from the decompose call and may be
 * phrased differently, so production hit-rate could be marginally lower.
 *
 * Run: npx tsx --env-file=.env.local eval/retrieval-check.ts
 *
 * ── LOCKED RESULTS (dataset v3, 8 PRDs, 49 tool-bearing capabilities) ──
 * Retrieval backend: BM25 (name+description+category) + Porter stemmer + a
 * 4-entry alias map. Hit-rate: @3 95.9%, @6 100.0% (49/49), @10 100.0%.
 * 43/49 expected tools rank #1; 0 misses, 0 semantic gaps, 0 absent.
 *
 * Evolution across Step 0 iterations (all free, no API):
 *   BM25 only          → @6 93.9%  (3 misses, all score=0 word-form mismatches)
 *   + Porter stemmer   → @6 95.9%  (fixed transactions/transaction; notify/
 *                                    notification survived — Porter's y→i makes
 *                                    notify→notifi ≠ notification→notif)
 *   + alias map        → @6 100.0% (notify→notification closes both; the two
 *                                    notification_dispatcher misses went to #1,
 *                                    transaction_history_api to #5)
 *
 * Decisions this locks: (1) BM25 is the retrieval backend — every miss was
 * lexical, never semantic, so embeddings are NOT justified; (2) k=6 (100% at 6);
 * (3) re-run this check whenever PRDs are added and grow the alias map only when
 * a new word-form miss actually appears.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(__dirname, "dataset/prds.json");

const K1 = 1.5;
const B = 0.75;

const STOP = new Set([
  "a","an","the","of","for","and","or","to","in","on","by","with","from","as","is","are","be",
  "this","that","these","those","it","its","at","all","each","every","must","should","we","our",
]);

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
  // Step 1a
  re = /^(.+?)(ss|i)es$/; re2 = /^(.+?)([^s])s$/;
  if (re.test(w)) w = w.replace(re, "$1$2");
  else if (re2.test(w)) w = w.replace(re2, "$1$2");
  // Step 1b
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
  // Step 1c
  re = /^(.+?)y$/;
  if (re.test(w)) { fp = re.exec(w); stem = fp![1]; re = new RegExp(s_v); if (re.test(stem)) w = stem + "i"; }
  // Step 2
  re = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
  if (re.test(w)) { fp = re.exec(w); stem = fp![1]; suffix = fp![2]; re = new RegExp(mgr0); if (re.test(stem)) w = stem + step2list[suffix]; }
  // Step 3
  re = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
  if (re.test(w)) { fp = re.exec(w); stem = fp![1]; suffix = fp![2]; re = new RegExp(mgr0); if (re.test(stem)) w = stem + step3list[suffix]; }
  // Step 4
  re = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/; re2 = /^(.+?)(s|t)(ion)$/;
  if (re.test(w)) { fp = re.exec(w); stem = fp![1]; re = new RegExp(mgr1); if (re.test(stem)) w = stem; }
  else if (re2.test(w)) { fp = re2.exec(w); stem = fp![1] + fp![2]; re2 = new RegExp(mgr1); if (re2.test(stem)) w = stem; }
  // Step 5
  re = /^(.+?)e$/;
  if (re.test(w)) { fp = re.exec(w); stem = fp![1]; re = new RegExp(mgr1); re2 = new RegExp(meq1); re3 = new RegExp("^" + C + v + "[^aeiouwxy]$"); if (re.test(stem) || (re2.test(stem) && !re3.test(stem))) w = stem; }
  re = /ll$/; re2 = new RegExp(mgr1);
  if (re.test(w) && re2.test(w)) { re = /.$/; w = w.replace(re, ""); }
  if (firstch === "y") w = firstch.toLowerCase() + w.substr(1);
  return w;
}

// Curated alias map — normalize verb forms to their noun form BEFORE stemming.
//
// WHY THIS EXISTS (a deliberate, diagnosed fix — not a hack): the Porter
// stemmer's step 1c maps a trailing "y" to "i" ("notify" → "notifi"), while the
// derived noun stems without it ("notification" → "notif"). The two forms miss
// by a single character, so BM25 scores them as unrelated. Step 0 caught exactly
// this: "notify ..." requirements never matched notification_dispatcher's
// "...notifications ...". notification_dispatcher has empty compliance_tags, so a
// retrieval miss there would mis-status a matched-and-risky capability as
// missing — this map protects gate accuracy, not just precision.
//
// Guardrail: every entry is a verb↔noun pair where BOTH forms plausibly appear
// in real banking PRDs and tool descriptions. Keep tight and evidence-driven —
// an auditable list anyone can read, never padding.
const ALIASES: Record<string, string> = {
  notify: "notification", // observed: prd_002 & prd_007 → notification_dispatcher
  verify: "verification", // KYC / income / identity verification tools
  authorize: "authorization", // card / payment authorization tools
  disburse: "disbursement", // loan / payroll disbursement tools
};

function normalizeToken(w: string): string {
  return porterStem(ALIASES[w] ?? w);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(normalizeToken);
}

type Tool = { name: string; description: string; category: string };

// --- BM25 index over the tool corpus ---
class BM25 {
  private docs: string[][];
  private names: string[];
  private df = new Map<string, number>();
  private avgdl: number;
  private N: number;
  constructor(tools: Tool[]) {
    this.names = tools.map((t) => t.name);
    this.docs = tools.map((t) =>
      tokenize(`${t.name} ${t.description} ${t.category}`),
    );
    this.N = this.docs.length;
    for (const doc of this.docs) {
      for (const term of new Set(doc)) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }
    this.avgdl = this.docs.reduce((s, d) => s + d.length, 0) / this.N;
  }
  private idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    return Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
  }
  /** Returns every tool ranked by BM25 score (desc), with score. */
  rank(query: string): { name: string; score: number }[] {
    const qterms = [...new Set(tokenize(query))];
    const scored = this.docs.map((doc, i) => {
      const len = doc.length;
      const tf = new Map<string, number>();
      for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const t of qterms) {
        const f = tf.get(t) ?? 0;
        if (f === 0) continue;
        score +=
          this.idf(t) *
          ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * len) / this.avgdl)));
      }
      return { name: this.names[i], score };
    });
    // Stable sort by score desc.
    return scored
      .map((s, i) => ({ ...s, i }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map(({ name, score }) => ({ name, score }));
  }
}

// --- Dataset types ---
type ExpectedMatch = { capability: string; expected_tool: string | null };
type Prd = { id: string; expected_matches: ExpectedMatch[] };
type Dataset = { prds: Prd[] };

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_* env vars.");
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("tools")
    .select("name, description, category");
  if (error) throw new Error(`Supabase: ${error.message}`);
  const tools = (data ?? []).map((t) => ({
    name: t.name ?? "",
    description: t.description ?? "",
    category: t.category ?? "",
  })) as Tool[];
  const validNames = new Set(tools.map((t) => t.name));

  const bm25 = new BM25(tools);
  const dataset: Dataset = JSON.parse(await readFile(DATASET_PATH, "utf8"));

  // Mechanism check: full tokenizer pipeline (alias + stem) on the problem forms.
  console.log("Tokenizer check (query-form → token  vs  doc-form → token):");
  for (const [a, b] of [["notify", "notifications"], ["transactions", "transaction"], ["verify", "verification"]]) {
    console.log(`  ${a}→${normalizeToken(a)}   ${b}→${normalizeToken(b)}   ${normalizeToken(a) === normalizeToken(b) ? "MATCH" : "no match"}`);
  }
  console.log("");

  type Row = {
    prd: string;
    capability: string;
    tool: string;
    rank: number; // 1-indexed; Infinity if tool name not in registry
    score: number;
  };
  const rows: Row[] = [];
  for (const prd of dataset.prds) {
    for (const m of prd.expected_matches) {
      if (!m.expected_tool) continue; // missing capabilities have no tool
      const ranked = bm25.rank(m.capability);
      const idx = ranked.findIndex((r) => r.name === m.expected_tool);
      const inRegistry = validNames.has(m.expected_tool);
      rows.push({
        prd: prd.id,
        capability: m.capability,
        tool: m.expected_tool,
        rank: idx === -1 ? Infinity : idx + 1,
        score: idx === -1 ? 0 : ranked[idx].score,
      });
      if (!inRegistry) {
        console.warn(`  ! ${m.expected_tool} (labeled in ${prd.id}) is NOT in the live registry`);
      }
    }
  }

  const total = rows.length;
  const hitAt = (k: number) => rows.filter((r) => r.rank <= k).length;
  const rate = (n: number) => ((100 * n) / total).toFixed(1);

  console.log(`Registry tools indexed: ${tools.length}`);
  console.log(`Labeled tool-bearing capabilities tested: ${total}\n`);
  console.log("Retrieval hit-rate (labeled expected_tool within top-k):");
  console.log(`  @3:  ${rate(hitAt(3))}%  (${hitAt(3)}/${total})`);
  console.log(`  @6:  ${rate(hitAt(6))}%  (${hitAt(6)}/${total})`);
  console.log(`  @10: ${rate(hitAt(10))}%  (${hitAt(10)}/${total})`);

  const missesAt6 = rows.filter((r) => r.rank > 6).sort((a, b) => a.rank - b.rank);
  console.log(`\nMisses @6 (${missesAt6.length}): expected_tool ranked outside top-6`);
  if (missesAt6.length === 0) console.log("  (none)");
  for (const m of missesAt6) {
    const rankStr = m.rank === Infinity ? "ABSENT (not in registry)" : `#${m.rank}`;
    const zero = m.rank !== Infinity && m.score === 0 ? " score=0 (no term overlap)" : "";
    console.log(`  ${m.prd}  ${m.tool}  → ${rankStr}${zero}`);
    console.log(`      req: "${m.capability.slice(0, 84)}"`);
  }

  // Resolution of the three original (pre-stemmer/pre-alias) Step 0 misses.
  const priorMisses: [string, string][] = [
    ["prd_001", "transaction_history_api"],
    ["prd_002", "notification_dispatcher"],
    ["prd_007", "notification_dispatcher"],
  ];
  console.log("\nResolution of original Step 0 misses:");
  for (const [prd, tool] of priorMisses) {
    const r = rows.find((x) => x.prd === prd && x.tool === tool);
    console.log(`  ${prd}  ${tool}  → now #${r?.rank}`);
  }

  // Distribution of ranks for context.
  const buckets = { "1": 0, "2-3": 0, "4-6": 0, "7-10": 0, "11+": 0, absent: 0 };
  for (const r of rows) {
    if (r.rank === Infinity) buckets.absent++;
    else if (r.rank === 1) buckets["1"]++;
    else if (r.rank <= 3) buckets["2-3"]++;
    else if (r.rank <= 6) buckets["4-6"]++;
    else if (r.rank <= 10) buckets["7-10"]++;
    else buckets["11+"]++;
  }
  console.log("\nRank distribution of expected_tool:");
  for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(7)} ${v}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
