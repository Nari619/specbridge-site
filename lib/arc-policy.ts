import type {
  AgentSession,
  Contract,
  Intervention,
  InterventionType,
} from "@/lib/arc-types";

// Canonical rule texts — recorded verbatim on every intervention so the
// Evidence Pack can cite exactly which rule fired.
export const TASK_RULES: Record<InterventionType, string> = {
  warn: "Per-task rule: if a session's cost crosses 80% of the contract's max_cost_per_task_usd, emit WARN.",
  throttle:
    "Per-task rule: if a session's cost crosses 95% of the contract's max_cost_per_task_usd, emit THROTTLE.",
  stop: "Per-task rule: if a session's cost reaches 100% of the contract's max_cost_per_task_usd, emit STOP — the session is terminated and its remaining cost is not spent.",
};

export const FLEET_RULES: Record<InterventionType, string> = {
  warn: "Per-fleet rule: if cumulative daily spend crosses 80% of the contract's daily_fleet_ceiling_usd, emit WARN.",
  throttle:
    "Per-fleet rule: if cumulative daily spend crosses 95% of the contract's daily_fleet_ceiling_usd, emit THROTTLE.",
  stop: "Per-fleet rule: if cumulative daily spend reaches 100% of the contract's daily_fleet_ceiling_usd, emit STOP — the agent fleet is halted for the rest of the UTC day and queued sessions do not run.",
};

const THRESHOLDS: { pct: 80 | 95 | 100; type: InterventionType }[] = [
  { pct: 80, type: "warn" },
  { pct: 95, type: "throttle" },
  { pct: 100, type: "stop" },
];

export type AgentPolicyTotals = {
  agent_name: string;
  sessions: number;
  /** ungoverned spend as observed in telemetry */
  raw_cost_usd: number;
  /** spend under governance (task caps applied, fleet stops honored) */
  spent_usd: number;
  /** cost avoided by STOPs — modeled counterfactual */
  saved_usd: number;
  stopped_sessions: number;
  suppressed_sessions: number;
  warns: number;
  throttles: number;
  stops: number;
};

export type PolicyRun = {
  interventions: Intervention[];
  totals: AgentPolicyTotals[];
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Replays sessions chronologically against the contracts and emits the
 * interventions ARC would have made. Savings are the modeled counterfactual:
 * task STOPs save the cost above the per-task cap; after a fleet STOP, the
 * full cost of every later session that UTC day is saved (it never runs).
 */
export function runPolicy(
  sessions: AgentSession[],
  contracts: Contract[],
): PolicyRun {
  const contractMap = new Map(contracts.map((c) => [c.agent_name, c]));
  const sorted = [...sessions].sort(
    (a, b) =>
      a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id),
  );

  const interventions: Intervention[] = [];
  let seq = 0;
  const totals = new Map<string, AgentPolicyTotals>();
  // key: `${agent}|${utcDay}` → cumulative raw spend + thresholds already fired
  const fleetDays = new Map<
    string,
    { raw: number; fired: Set<InterventionType>; stopped: boolean }
  >();

  const push = (
    type: InterventionType,
    scope: "task" | "fleet",
    session: AgentSession,
    thresholdPct: 80 | 95 | 100,
    ruleText: string,
    reason: string,
    timestamp: string,
  ) => {
    interventions.push({
      id: `int_${String(seq++).padStart(4, "0")}`,
      type,
      scope,
      agent_name: session.agent_name,
      session_id: session.id,
      contract_ref: session.agent_name,
      threshold_pct: thresholdPct,
      rule_text: ruleText,
      reason,
      timestamp,
    });
    const t = totals.get(session.agent_name)!;
    if (type === "warn") t.warns++;
    else if (type === "throttle") t.throttles++;
    else t.stops++;
  };

  for (const session of sorted) {
    let t = totals.get(session.agent_name);
    if (!t) {
      t = {
        agent_name: session.agent_name,
        sessions: 0,
        raw_cost_usd: 0,
        spent_usd: 0,
        saved_usd: 0,
        stopped_sessions: 0,
        suppressed_sessions: 0,
        warns: 0,
        throttles: 0,
        stops: 0,
      };
      totals.set(session.agent_name, t);
    }
    t.sessions++;
    t.raw_cost_usd += session.cost_usd;

    const contract = contractMap.get(session.agent_name);
    if (!contract) {
      t.spent_usd += session.cost_usd;
      continue;
    }

    const day = session.started_at.slice(0, 10);
    const fleetKey = `${session.agent_name}|${day}`;
    let fleet = fleetDays.get(fleetKey);
    if (!fleet) {
      fleet = { raw: 0, fired: new Set(), stopped: false };
      fleetDays.set(fleetKey, fleet);
    }

    // Fleet already stopped today: the session never runs. Its whole cost
    // is avoided (modeled), and no task-level rules apply.
    if (fleet.stopped) {
      t.suppressed_sessions++;
      t.saved_usd += session.cost_usd;
      fleet.raw += session.cost_usd; // observed burn had ARC not intervened
      continue;
    }

    // --- Per-task thresholds, on this session's cost ---
    const cap = contract.max_cost_per_task_usd;
    const startMs = Date.parse(session.started_at);
    const endMs = Date.parse(session.ended_at);
    // Cost accrues across the session; place each crossing proportionally.
    const atFraction = (pct: number) =>
      new Date(
        startMs +
          (endMs - startMs) * Math.min(1, (cap * (pct / 100)) / session.cost_usd),
      ).toISOString();

    let spentThisSession = session.cost_usd;
    for (const { pct, type } of THRESHOLDS) {
      if (session.cost_usd < cap * (pct / 100)) break;
      const ruleText = TASK_RULES[type];
      if (type === "stop") {
        const saved = round2(session.cost_usd - cap);
        spentThisSession = cap;
        t.stopped_sessions++;
        t.saved_usd += saved;
        push(
          type,
          "task",
          session,
          pct,
          ruleText,
          `Session cost reached $${session.cost_usd.toFixed(2)}, ${Math.round((session.cost_usd / cap) * 100)}% of the $${cap.toFixed(2)} per-task cap — terminated at the cap; $${saved.toFixed(2)} remaining not spent (modeled).`,
          atFraction(pct),
        );
      } else {
        push(
          type,
          "task",
          session,
          pct,
          ruleText,
          `Session cost crossed ${pct}% of the $${cap.toFixed(2)} per-task cap (contract: ${contract.agent_name}).`,
          atFraction(pct),
        );
      }
    }
    t.spent_usd += spentThisSession;

    // --- Per-fleet thresholds, on cumulative observed daily spend ---
    fleet.raw += session.cost_usd;
    const ceiling = contract.daily_fleet_ceiling_usd;
    for (const { pct, type } of THRESHOLDS) {
      if (fleet.raw < ceiling * (pct / 100) || fleet.fired.has(type)) continue;
      fleet.fired.add(type);
      push(
        type,
        "fleet",
        session,
        pct,
        FLEET_RULES[type],
        `Cumulative ${day} spend reached $${fleet.raw.toFixed(2)}, ${pct}% of the $${ceiling.toFixed(2)} daily fleet ceiling (contract: ${contract.agent_name}).`,
        session.ended_at,
      );
      if (type === "stop") fleet.stopped = true;
    }
  }

  for (const t of totals.values()) {
    t.raw_cost_usd = round2(t.raw_cost_usd);
    t.spent_usd = round2(t.spent_usd);
    t.saved_usd = round2(t.saved_usd);
  }

  return {
    interventions,
    totals: [...totals.values()].sort((a, b) =>
      a.agent_name.localeCompare(b.agent_name),
    ),
  };
}

// --- Determinism check: the product claim is "same seed in → identical
// interventions out, every run". FNV-1a over the serialized run.
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Runs the full pipeline twice from scratch (fresh simulation + fresh
 * policy replay) and asserts byte-identical output. Throws on mismatch.
 */
export function verifyDeterminism(
  simulate: () => AgentSession[],
  contracts: Contract[],
): { hash: string; interventionCount: number } {
  const runA = runPolicy(simulate(), contracts);
  const runB = runPolicy(simulate(), contracts);
  const hashA = fnv1aHex(JSON.stringify(runA));
  const hashB = fnv1aHex(JSON.stringify(runB));
  if (hashA !== hashB) {
    throw new Error(
      `ARC determinism violated: run A hashed ${hashA}, run B hashed ${hashB}`,
    );
  }
  return { hash: hashA, interventionCount: runA.interventions.length };
}
