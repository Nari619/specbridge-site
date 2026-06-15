import type { AgentSession, Contract } from "@/lib/arc-types";

export type EconomicsVerdict =
  | "HEALTHY"
  | "REVIEW"
  | "UNECONOMIC"
  | "UNMEASURED";

export type AgentEconomics = {
  agent_name: string;
  sessions: number;
  completed_tasks: number;
  /** ungoverned spend as observed in telemetry */
  total_spend_usd: number;
  /** total spend / completed tasks — null if nothing completed */
  cpa_usd: number | null;
  business_value_per_task_usd: number | "unknown";
  /** business value per task / CPA — null when value is unknown or CPA undefined */
  roi_per_run: number | null;
  cpa_day1_usd: number | null;
  cpa_day2_usd: number | null;
  /** (day2 − day1) / day1, as a percentage — null if either day is undefined */
  cpa_trend_pct: number | null;
  rising: boolean;
  verdict: EconomicsVerdict;
  verdict_note: string;
};

/** CPA is considered "rising" past this day-over-day increase. */
const RISING_THRESHOLD_PCT = 10;

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

/**
 * Pure, deterministic per-agent economics over observed telemetry.
 * `daySplitMs` divides the window into day 1 (< split) and day 2 (≥ split)
 * so the trend can expose slow cost drift.
 */
export function computeEconomics(
  sessions: AgentSession[],
  contracts: Contract[],
  daySplitMs: number,
): AgentEconomics[] {
  const results: AgentEconomics[] = [];

  for (const contract of contracts) {
    const agentSessions = sessions.filter(
      (s) => s.agent_name === contract.agent_name,
    );

    let spend = 0;
    let completed = 0;
    let day1Spend = 0;
    let day1Completed = 0;
    let day2Spend = 0;
    let day2Completed = 0;

    for (const s of agentSessions) {
      spend += s.cost_usd;
      const isDay1 = Date.parse(s.started_at) < daySplitMs;
      if (isDay1) day1Spend += s.cost_usd;
      else day2Spend += s.cost_usd;
      if (s.outcome === "success") {
        completed++;
        if (isDay1) day1Completed++;
        else day2Completed++;
      }
    }

    const cpa = completed > 0 ? spend / completed : null;
    const cpaDay1 = day1Completed > 0 ? day1Spend / day1Completed : null;
    const cpaDay2 = day2Completed > 0 ? day2Spend / day2Completed : null;
    const trendPct =
      cpaDay1 !== null && cpaDay2 !== null && cpaDay1 > 0
        ? ((cpaDay2 - cpaDay1) / cpaDay1) * 100
        : null;
    const rising = trendPct !== null && trendPct > RISING_THRESHOLD_PCT;

    const value = contract.business_value_per_task_usd;
    const roi = value !== "unknown" && cpa !== null ? value / cpa : null;

    let verdict: EconomicsVerdict;
    let note: string;
    if (value === "unknown") {
      verdict = "UNMEASURED";
      note =
        "Business value per task is not instrumented. Instrument value first. No ROI is computed or guessed for unmeasured agents.";
    } else if (cpa === null) {
      verdict = "UNMEASURED";
      note = "No completed tasks in the window. CPA is undefined.";
    } else if (roi !== null && roi < 1) {
      verdict = "UNECONOMIC";
      note = `Each completed task costs more than it returns (ROI ${roi.toFixed(2)}x, modeled).`;
    } else if ((roi !== null && roi <= 3) || rising) {
      verdict = "REVIEW";
      note = rising
        ? `CPA rose ${trendPct!.toFixed(1)}% day-over-day${roi !== null ? ` while ROI sits at ${roi.toFixed(1)}x` : ""}: investigate the drift (modeled).`
        : `ROI of ${roi!.toFixed(1)}x is inside the 1 to 3x review band (modeled).`;
    } else {
      verdict = "HEALTHY";
      note = `ROI ${roi!.toFixed(1)}x with stable CPA (modeled).`;
    }

    results.push({
      agent_name: contract.agent_name,
      sessions: agentSessions.length,
      completed_tasks: completed,
      total_spend_usd: round(spend, 2),
      cpa_usd: cpa !== null ? round(cpa, 4) : null,
      business_value_per_task_usd: value,
      roi_per_run: roi !== null ? round(roi, 2) : null,
      cpa_day1_usd: cpaDay1 !== null ? round(cpaDay1, 4) : null,
      cpa_day2_usd: cpaDay2 !== null ? round(cpaDay2, 4) : null,
      cpa_trend_pct: trendPct !== null ? round(trendPct, 1) : null,
      rising,
      verdict,
      verdict_note: note,
    });
  }

  return results;
}
