/**
 * PRD-to-PRD duplicate detection (v1). Deterministic, no LLM. When a PM submits
 * a PRD, this finds past PRDs (from the analyses memory) that genuinely overlap
 * — "another team is about to build the same thing" — surfaced at the moment of
 * the build decision.
 *
 * Method: TF-IDF cosine over the LOCKED retrieval tokenizer (stopwords → alias
 * map → Porter stemmer, reused from lib/retrieval.ts). Cosine is the symmetric,
 * normalized ([0,1]) member of the BM25/TF-IDF family — the right shape for
 * order-independent PRD-vs-PRD similarity with a meaningful threshold. The
 * threshold below is a named tunable, calibrated on real pairs (see
 * eval/calibrate-similarity.ts), not guessed.
 *
 * Additive and flagged: this module is imported only where the feature is
 * wired; it cannot affect the production single analysis engine.
 */
import { tokenize } from "@/lib/retrieval";
import type { Capability } from "@/lib/analyze-core";

/**
 * Similarity at/above which two PRDs are treated as genuinely overlapping.
 *
 * CALIBRATED (see eval/calibrate-similarity.ts), not guessed. On real pairs,
 * genuine duplicates scored 0.587-0.679 while everything else — including the
 * hard "same domain, different intent" case (personal loan vs mortgage, 0.279) —
 * scored <= 0.279. That leaves a clean empty gap of 0.28-0.59. 0.40 sits in it
 * with ~0.12 margin above the highest false positive and ~0.19 below the lowest
 * true positive, biased slightly toward avoiding false positives (a wrong
 * "duplicate!" callout costs more credibility than a quiet miss). The initial
 * 0.15 guess was far too low — it would have fired on same-domain pairs.
 * Re-run the calibration if the tokenizer or the PRD corpus changes materially.
 */
export const PRD_SIMILARITY_THRESHOLD = 0.4;

type Vec = Map<string, number>;

function dot(a: Vec, b: Vec): number {
  // Iterate the smaller vector.
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [t, w] of small) {
    const w2 = big.get(t);
    if (w2 !== undefined) s += w * w2;
  }
  return s;
}
function norm(a: Vec): number {
  let s = 0;
  for (const w of a.values()) s += w * w;
  return Math.sqrt(s);
}

export type PrdRef = { id: string; text: string };
export type SimilarPrd = { id: string; score: number };

export type PrdComparer = {
  /** Cosine similarity in [0,1] between two PRD texts, using the corpus IDF. */
  similarity(textA: string, textB: string): number;
  /**
   * Rank candidates by similarity to a query PRD, descending, keeping only
   * those at/above `threshold`. `excludeExactText` drops a candidate whose text
   * is byte-identical to the query (the current PRD re-appearing in history).
   */
  findSimilar(
    queryText: string,
    candidates: PrdRef[],
    threshold?: number,
  ): SimilarPrd[];
};

/**
 * Build a comparer whose IDF weights come from `corpus` (all the PRDs in play —
 * in production, the analyses history plus the current PRD). IDF over the whole
 * collection is what makes shared *distinctive* terms (e.g. "chargeback",
 * "bureau") count more than boilerplate ("customer", "system").
 */
export function createPrdComparer(corpus: PrdRef[]): PrdComparer {
  const tokenized = corpus.map((p) => tokenize(p.text));
  const N = Math.max(1, tokenized.length);
  const df = new Map<string, number>();
  for (const toks of tokenized) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = (t: string) => {
    const n = df.get(t) ?? 0;
    // Smoothed idf; +1 keeps terms unseen in the corpus usable.
    return Math.log((N + 1) / (n + 1)) + 1;
  };
  const vec = (text: string): Vec => {
    const toks = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v: Vec = new Map();
    for (const [t, f] of tf) v.set(t, f * idf(t));
    return v;
  };

  const similarity = (a: string, b: string): number => {
    const va = vec(a);
    const vb = vec(b);
    const na = norm(va);
    const nb = norm(vb);
    if (na === 0 || nb === 0) return 0;
    return Number((dot(va, vb) / (na * nb)).toFixed(4));
  };

  return {
    similarity,
    findSimilar(queryText, candidates, threshold = PRD_SIMILARITY_THRESHOLD) {
      const qn = queryText.trim();
      return candidates
        .filter((c) => c.text.trim() !== qn) // drop the exact current PRD
        .map((c) => ({ id: c.id, score: similarity(queryText, c.text) }))
        .filter((r) => r.score >= threshold)
        .sort((a, b) => b.score - a.score);
    },
  };
}

/**
 * The specific capabilities two analyses share — a match callout is only useful
 * ("here are the 3 capabilities you both need") if it names them. Overlap is by
 * matched_tool (the concrete shared dependency); missing capabilities (no tool)
 * are matched by normalized requirement text.
 */
export type CapabilityOverlap = {
  matched_tool: string | null;
  current_requirement: string;
  past_requirement: string;
};

export function overlappingCapabilities(
  current: Capability[],
  past: Capability[],
): CapabilityOverlap[] {
  const overlaps: CapabilityOverlap[] = [];
  const pastByTool = new Map<string, Capability>();
  for (const c of past) if (c.matched_tool) pastByTool.set(c.matched_tool, c);

  const normReq = (s: string) =>
    tokenize(s).sort().join(" "); // order-independent requirement key

  const pastMissingKeys = new Map<string, Capability>();
  for (const c of past) if (!c.matched_tool) pastMissingKeys.set(normReq(c.requirement), c);

  for (const c of current) {
    if (c.matched_tool && pastByTool.has(c.matched_tool)) {
      const p = pastByTool.get(c.matched_tool)!;
      overlaps.push({
        matched_tool: c.matched_tool,
        current_requirement: c.requirement,
        past_requirement: p.requirement,
      });
    } else if (!c.matched_tool) {
      const key = normReq(c.requirement);
      const p = pastMissingKeys.get(key);
      if (p) {
        overlaps.push({
          matched_tool: null,
          current_requirement: c.requirement,
          past_requirement: p.requirement,
        });
      }
    }
  }
  return overlaps;
}
