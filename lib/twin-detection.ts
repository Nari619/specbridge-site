/**
 * Twin-catcher: find a past PRD (from the analyses memory) that genuinely
 * overlaps the current one — "another team already scoped this." Deterministic,
 * no LLM. Fully additive: nothing here touches the analysis engines.
 *
 * Q1 text-similarity (fires the instant a PRD is pasted, before an analysis is
 * spent), Q3 against ALL analyses (cross-team, cross-time) excluding the exact
 * current PRD, Q5 returns the specific overlapping capabilities so the callout
 * is a tool, not a gimmick.
 */
import {
  createPrdComparer,
  overlappingCapabilities,
  type CapabilityOverlap,
} from "@/lib/prd-similarity";
import type { Capability, AnalysisResult } from "@/lib/analyze-core";

export type TwinMatch = {
  id: string;
  title: string;
  created_at: string;
  score: number;
  overlaps: CapabilityOverlap[];
};

/**
 * Best-effort: any Supabase/parse failure returns null so the callout simply
 * doesn't show — it can never break the analysis flow.
 */
export async function findTwin(
  prdText: string,
  capabilities: Capability[],
): Promise<TwinMatch | null> {
  try {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("analyses")
      .select("id, prd_title, prd_text, created_at, full_result")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error || !data || data.length === 0) return null;

    const candidates = data
      .filter(
        (r): r is typeof r & { prd_text: string } =>
          typeof r.prd_text === "string" && r.prd_text.trim().length > 0,
      )
      .map((r) => ({ id: String(r.id), text: r.prd_text }));
    if (candidates.length === 0) return null;

    // IDF over the current PRD + all candidates.
    const comparer = createPrdComparer([
      { id: "__current__", text: prdText },
      ...candidates,
    ]);
    const matches = comparer.findSimilar(prdText, candidates); // >= threshold, sorted desc
    if (matches.length === 0) return null;

    const top = matches[0];
    const row = data.find((r) => String(r.id) === top.id);
    if (!row) return null;

    const pastCaps =
      (row.full_result as AnalysisResult | null)?.capabilities ?? [];
    const overlaps = overlappingCapabilities(capabilities, pastCaps);

    return {
      id: String(row.id),
      title: row.prd_title ?? "Untitled analysis",
      created_at: String(row.created_at),
      score: top.score,
      overlaps,
    };
  } catch {
    return null;
  }
}
