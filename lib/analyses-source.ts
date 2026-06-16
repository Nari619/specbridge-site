import type { AnalysisResult } from "@/app/api/analyze/route";

export type AnalysisListItem = {
  id: string;
  prd_title: string | null;
  readiness_score: number | null;
  verdict: string | null;
  covered_count: number | null;
  partial_count: number | null;
  risky_count: number | null;
  missing_count: number | null;
  created_at: string;
};

export type AnalysesSummary = {
  total: number;
  avgScore: number | null;
  totalSavings: number;
  totalRisky: number;
  goCount: number;
  nogoCount: number;
};

export type AnalysesOverview = {
  ok: boolean;
  summary: AnalysesSummary;
  recent: AnalysisListItem[];
};

export type AnalysisDetail = {
  id: string;
  prd_title: string | null;
  created_at: string;
  result: AnalysisResult;
};

const EMPTY_SUMMARY: AnalysesSummary = {
  total: 0,
  avgScore: null,
  totalSavings: 0,
  totalRisky: 0,
  goCount: 0,
  nogoCount: 0,
};

const SUMMARY_COLS =
  "id, prd_title, readiness_score, verdict, covered_count, partial_count, risky_count, missing_count, savings_estimate, created_at";

type SummaryRow = {
  id: string | number;
  prd_title: string | null;
  readiness_score: number | null;
  verdict: string | null;
  covered_count: number | null;
  partial_count: number | null;
  risky_count: number | null;
  missing_count: number | null;
  savings_estimate: number | null;
  created_at: string;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Totals across ALL saved analyses + the most recent rows. Best-effort: any
 * failure (including a missing-env import crash) is caught and returns an empty
 * overview with ok:false, so the dashboard renders a graceful state instead of
 * crashing. The Supabase client is pulled in via dynamic import to keep it out
 * of this module's static graph.
 */
export async function getAnalysesOverview(): Promise<AnalysesOverview> {
  try {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("analyses")
      .select(SUMMARY_COLS)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[dashboard] failed to read analyses:", error.message);
      return { ok: false, summary: EMPTY_SUMMARY, recent: [] };
    }

    const rows = (data ?? []) as unknown as SummaryRow[];
    const scores = rows
      .map((r) => Number(r.readiness_score))
      .filter((n) => Number.isFinite(n));

    const summary: AnalysesSummary = {
      total: rows.length,
      avgScore: scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null,
      totalSavings: rows.reduce((s, r) => s + num(r.savings_estimate), 0),
      totalRisky: rows.reduce((s, r) => s + num(r.risky_count), 0),
      goCount: rows.filter((r) => String(r.verdict).toUpperCase() === "GO")
        .length,
      nogoCount: rows.filter(
        (r) => String(r.verdict).toUpperCase() === "NO-GO",
      ).length,
    };

    const recent: AnalysisListItem[] = rows.slice(0, 20).map((r) => ({
      id: String(r.id),
      prd_title: r.prd_title,
      readiness_score: r.readiness_score,
      verdict: r.verdict,
      covered_count: r.covered_count,
      partial_count: r.partial_count,
      risky_count: r.risky_count,
      missing_count: r.missing_count,
      created_at: r.created_at,
    }));

    return { ok: true, summary, recent };
  } catch (e) {
    console.error(
      "[dashboard] analyses overview failed:",
      e instanceof Error ? e.message : e,
    );
    return { ok: false, summary: EMPTY_SUMMARY, recent: [] };
  }
}

/** Fetch one saved analysis (with its full_result) for the detail view. */
export async function getAnalysisById(
  id: string,
): Promise<AnalysisDetail | null> {
  try {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("analyses")
      .select("id, prd_title, created_at, full_result")
      .eq("id", id)
      .single();

    if (error || !data) {
      if (error) {
        console.error("[dashboard] failed to read analysis:", error.message);
      }
      return null;
    }

    const row = data as unknown as {
      id: string | number;
      prd_title: string | null;
      created_at: string;
      full_result: AnalysisResult;
    };

    return {
      id: String(row.id),
      prd_title: row.prd_title,
      created_at: row.created_at,
      result: row.full_result,
    };
  } catch (e) {
    console.error(
      "[dashboard] analysis detail failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
