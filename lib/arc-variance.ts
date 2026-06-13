import type { AgentSession, Contract } from "@/lib/arc-types";
import type { AgentEconomics } from "@/lib/arc-economics";

export type VarianceDirection = "over" | "under" | "on-track";

export type AgentVariance = {
  agent_name: string;
  estimate_usd: number;
  /** ARC's observed cost-per-action; null when no tasks completed */
  actual_cpa_usd: number | null;
  /** actual / estimate; null when actual undefined */
  ratio: number | null;
  /** (actual − estimate) / estimate, as a percentage; null when actual undefined */
  variance_pct: number | null;
  direction: VarianceDirection;
  /** one-line plain-English cause drawn from the telemetry */
  cause: string;
  /** correction SpecBridge should fold into its next estimate, when actual far exceeds estimate */
  next_estimate_should_assume: string | null;
};

// Above this overrun ratio we treat the gap as material feedback for SpecBridge.
const MATERIAL_OVERRUN = 1.5;
const ON_TRACK_BAND_PCT = 15;

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

type AgentSignals = {
  avgRetries: number;
  maxRetries: number;
  retryTaskShare: number; // fraction of sessions with >=1 retry
  failureShare: number;
};

function signals(sessions: AgentSession[]): AgentSignals {
  if (sessions.length === 0)
    return { avgRetries: 0, maxRetries: 0, retryTaskShare: 0, failureShare: 0 };
  let retries = 0;
  let maxRetries = 0;
  let withRetry = 0;
  let failures = 0;
  for (const s of sessions) {
    retries += s.retries;
    maxRetries = Math.max(maxRetries, s.retries);
    if (s.retries > 0) withRetry++;
    if (s.outcome !== "success") failures++;
  }
  return {
    avgRetries: retries / sessions.length,
    maxRetries,
    retryTaskShare: withRetry / sessions.length,
    failureShare: failures / sessions.length,
  };
}

export function computeVariance(
  sessions: AgentSession[],
  contracts: Contract[],
  economics: AgentEconomics[],
): AgentVariance[] {
  const econByAgent = new Map(economics.map((e) => [e.agent_name, e]));

  return contracts.map((contract) => {
    const econ = econByAgent.get(contract.agent_name);
    const estimate = contract.specbridge_estimate_usd;
    const actual = econ?.cpa_usd ?? null;
    const agentSessions = sessions.filter(
      (s) => s.agent_name === contract.agent_name,
    );
    const sig = signals(agentSessions);

    if (actual === null) {
      return {
        agent_name: contract.agent_name,
        estimate_usd: estimate,
        actual_cpa_usd: null,
        ratio: null,
        variance_pct: null,
        direction: "on-track" as VarianceDirection,
        cause: "No completed tasks in the window — no actual to compare.",
        next_estimate_should_assume: null,
      };
    }

    const ratio = actual / estimate;
    const variancePct = ((actual - estimate) / estimate) * 100;
    const direction: VarianceDirection =
      Math.abs(variancePct) <= ON_TRACK_BAND_PCT
        ? "on-track"
        : variancePct > 0
          ? "over"
          : "under";

    // Cause is drawn from the strongest signal in the telemetry, in priority
    // order: retry storms, then cost creep, then "tracks estimate".
    let cause: string;
    if (ratio >= MATERIAL_OVERRUN && sig.avgRetries >= 2) {
      cause = `Actual ${ratio.toFixed(1)}x estimate — driven by retry storms: avg ${sig.avgRetries.toFixed(1)} retries/task (peak ${sig.maxRetries}), ${Math.round(sig.failureShare * 100)}% of tasks failing.`;
    } else if (econ?.rising && econ.cpa_trend_pct !== null) {
      cause = `Actual ${ratio.toFixed(1)}x estimate — cost creep: CPA drifted +${econ.cpa_trend_pct.toFixed(1)}% day-over-day, unnoticed at design time.`;
    } else if (direction === "on-track") {
      cause = `Tracks the design-time estimate within ${Math.abs(variancePct).toFixed(0)}% — ARC confirms SpecBridge got this one right.`;
    } else if (direction === "over") {
      cause = `Actual ${ratio.toFixed(1)}x estimate — running ${variancePct.toFixed(0)}% above the design-time number with no single dominant driver.`;
    } else {
      cause = `Actual ${Math.abs(variancePct).toFixed(0)}% below estimate — SpecBridge was conservative here.`;
    }

    // Feedback for SpecBridge when the overrun is material.
    let nextAssume: string | null = null;
    if (ratio >= MATERIAL_OVERRUN) {
      if (sig.avgRetries >= 2) {
        nextAssume = `Next estimate should assume a retry budget — price in ~${Math.ceil(sig.avgRetries)} retries/task for this tool class, not the happy path.`;
      } else if (econ?.rising) {
        nextAssume = `Next estimate should assume cost drift — add a per-day creep allowance instead of a flat per-task figure.`;
      } else {
        nextAssume = `Next estimate should be revised up toward the observed ${actual.toFixed(2)} CPA for this feature.`;
      }
    }

    return {
      agent_name: contract.agent_name,
      estimate_usd: estimate,
      actual_cpa_usd: round(actual, 4),
      ratio: round(ratio, 2),
      variance_pct: round(variancePct, 1),
      direction,
      cause,
      next_estimate_should_assume: nextAssume,
    };
  });
}
