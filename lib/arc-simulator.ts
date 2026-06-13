import contractsJson from "@/data/arc-contracts.json";
import type { AgentSession, Contract, SessionOutcome } from "@/lib/arc-types";

// JSON imports widen the "unknown" literal to string, so assert the shape.
export const contracts = contractsJson.contracts as Contract[];

// Fixed window so every demo run produces byte-identical data.
export const SIM_START = Date.parse("2026-06-10T08:00:00Z");
export const SIM_END = SIM_START + 48 * 3600_000;

// Mulberry32 — tiny seeded PRNG, deterministic across runs and platforms.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type AgentProfile = {
  agent: string;
  task: string;
  /** average sessions per hour at peak */
  baseRatePerHour: number;
  /** typical cost band per task, day one */
  costBand: [number, number];
  apiCallBand: [number, number];
  failureRate: number;
  /** compounding per-day cost drift (the creeper) */
  dailyCostDrift?: number;
  /** retry-loop storyline window, in hours from sim start (the villain) */
  runawayFromHour?: number;
};

const profiles: AgentProfile[] = [
  {
    agent: "refund-processing",
    task: "Evaluate and execute customer refund requests",
    baseRatePerHour: 10,
    costBand: [0.16, 0.33],
    apiCallBand: [3, 7],
    failureRate: 0.04,
  },
  {
    agent: "kyc-review",
    task: "First-pass review of KYC document packets",
    baseRatePerHour: 4,
    costBand: [0.5, 0.78],
    apiCallBand: [5, 11],
    failureRate: 0.06,
  },
  {
    agent: "fraud-investigation",
    task: "Assemble evidence packets for flagged transactions",
    baseRatePerHour: 1.2,
    costBand: [1.0, 1.65],
    apiCallBand: [8, 18],
    failureRate: 0.05,
  },
  {
    agent: "invoice-reconciliation",
    task: "Match supplier invoices to purchase orders and ledger entries",
    baseRatePerHour: 6,
    costBand: [0.12, 0.26],
    apiCallBand: [2, 5],
    failureRate: 0.03,
    runawayFromHour: 36,
  },
  {
    agent: "support-triage",
    task: "Classify and route inbound support messages",
    baseRatePerHour: 12,
    costBand: [0.06, 0.095],
    apiCallBand: [1, 3],
    failureRate: 0.02,
    dailyCostDrift: 0.15,
  },
];

function between(rand: () => number, low: number, high: number): number {
  return low + rand() * (high - low);
}

/** Diurnal load: quiet overnight, peaking early afternoon UTC. */
function hourWeight(hourUtc: number): number {
  return 0.45 + 0.55 * Math.sin((Math.PI * ((hourUtc + 24 - 6) % 24)) / 18);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function buildSession(
  rand: () => number,
  profile: AgentProfile,
  index: number,
  startMs: number,
): AgentSession {
  const elapsedDays = (startMs - SIM_START) / 86_400_000;
  const hour = (startMs - SIM_START) / 3600_000;
  const runaway =
    profile.runawayFromHour !== undefined && hour >= profile.runawayFromHour;

  let apiCalls: number;
  let retries: number;
  let cost: number;
  let outcome: SessionOutcome;
  let durationSec: number;

  if (runaway) {
    // The villain: stuck in a retry loop, re-calling the same failing tool.
    retries = Math.round(between(rand, 5, 12));
    apiCalls = retries * Math.round(between(rand, 2, 4));
    cost = between(rand, 2.2, 7.5);
    outcome = rand() < 0.92 ? "failure" : "aborted";
    durationSec = between(rand, 240, 900);
  } else {
    const drift = profile.dailyCostDrift
      ? Math.pow(1 + profile.dailyCostDrift, elapsedDays)
      : 1;
    apiCalls = Math.round(
      between(rand, profile.apiCallBand[0], profile.apiCallBand[1]),
    );
    retries = rand() < 0.1 ? Math.round(between(rand, 1, 2)) : 0;
    cost =
      between(rand, profile.costBand[0], profile.costBand[1]) *
      drift *
      (1 + retries * 0.18);
    outcome = rand() < profile.failureRate ? "failure" : "success";
    durationSec = between(rand, 25, 170) * (1 + retries * 0.4);
  }

  // Tokens correlate with cost: ~22K input / ~3.5K output tokens per dollar.
  const inputTokens = Math.round(cost * between(rand, 18000, 26000));
  const outputTokens = Math.round(cost * between(rand, 2800, 4200));
  const endMs = startMs + Math.round(durationSec * 1000);

  return {
    id: `ses_${profile.agent.replace(/-/g, "")}_${String(index).padStart(4, "0")}`,
    agent_name: profile.agent,
    task_type: profile.task,
    api_calls: apiCalls,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: round2(cost),
    retries,
    started_at: new Date(startMs).toISOString(),
    ended_at: new Date(endMs).toISOString(),
    outcome,
  };
}

function simulate(): AgentSession[] {
  const sessions: AgentSession[] = [];

  for (const profile of profiles) {
    // Per-agent PRNG stream so adding an agent never reshuffles the others.
    const seed = [...profile.agent].reduce(
      (acc, ch) => Math.imul(acc, 31) + ch.charCodeAt(0),
      7,
    );
    const rand = mulberry32(seed ^ 0x9e3779b9);
    let index = 0;

    for (let hour = 0; hour < 48; hour++) {
      const hourStart = SIM_START + hour * 3600_000;
      const hourUtc = new Date(hourStart).getUTCHours();
      const runaway =
        profile.runawayFromHour !== undefined &&
        hour >= profile.runawayFromHour;
      // The retry loop also inflates session volume: the queue keeps re-dispatching.
      const rate =
        profile.baseRatePerHour * (runaway ? 1.6 : hourWeight(hourUtc));
      const count = Math.max(
        runaway ? 1 : 0,
        Math.round(rate * between(rand, 0.7, 1.3)),
      );

      for (let i = 0; i < count; i++) {
        const startMs = hourStart + Math.floor(rand() * 3600_000);
        sessions.push(buildSession(rand, profile, index++, startMs));
      }
    }
  }

  return sessions.sort((a, b) => a.started_at.localeCompare(b.started_at));
}

let cache: AgentSession[] | null = null;

/** 48 hours of seeded fleet telemetry — identical on every call. */
export function simulateFleet(): AgentSession[] {
  if (!cache) cache = simulate();
  return cache;
}

/** Uncached run for determinism checks: regenerates everything from the seed. */
export function simulateFleetFresh(): AgentSession[] {
  return simulate();
}
