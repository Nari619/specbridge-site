/**
 * Shared, engine-agnostic analysis core. Holds the deterministic pieces that
 * BOTH the single-call engine and the orchestrator engine depend on: the
 * capability/result types, the parse helpers, and — critically — the
 * deterministic compliance gate (deterministicPiiScan + applyComplianceRules)
 * and the readiness score.
 *
 * This module is the structural expression of "agent proposes, code disposes":
 * whatever an engine produces as functional capabilities, it hands them to
 * finalizeAndScore() here, which runs the same PII backstop, the same gate, and
 * the same scoring for every engine. No LLM, no Anthropic import — pure code.
 * Never let an engine bypass this.
 */
import type { RegistryTool } from "@/lib/registry-source";

const STATUSES = ["covered", "partial", "risky", "missing"] as const;
export type CapabilityStatus = (typeof STATUSES)[number];

// "risky" is NOT assigned by the LLM. The model classifies functional fit only;
// the risky/not-risky decision is made deterministically in code from the
// registry's compliance_tags (see applyComplianceRules).
export const LLM_STATUSES = ["covered", "partial", "missing"] as const;

// The only clearances code understands. A required_clearance outside this set
// is ignored, so a hallucinated tag can never trigger a risky flag.
export const KNOWN_CLEARANCES = ["pii-cleared", "audit-grade"] as const;

// Sensitive-data signals for the deterministic PII backstop. Case-insensitive,
// matched whole-word. Extend this list to broaden the backstop.
const PII_SIGNALS = [
  "pii",
  "ssn",
  "social security",
  "personal data",
  "customer data",
  "account number",
  "date of birth",
  "kyc",
  "passport",
  "credit card",
] as const;

const PII_SIGNAL_PATTERNS = PII_SIGNALS.map(
  (s) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
);

const STATUS_WEIGHTS: Record<CapabilityStatus, number> = {
  covered: 1,
  partial: 0.5,
  risky: 0.35,
  missing: 0,
};

export type ReuseDetails = {
  version: string | null;
  owner_team: string | null;
  owner_contact: string | null;
  docs_url: string | null;
  repo_path: string | null;
  compliance_tags: string[];
  est_cost_per_call_usd: { low: number; high: number } | null;
  stack: string[] | null;
  input_parameters: { name: string; type: string; required: boolean }[];
  example_call: unknown;
  example_response: unknown;
};

export type ModificationPlan = {
  whats_missing: string;
  change_needed: string;
  modify_effort_days: number;
  build_new_effort_weeks: number;
  est_savings_usd: number;
};

export type RiskBlock = {
  missing_clearance: string;
  unblock_contact: string;
  est_unblock_time: string;
};

export type BuildPack = {
  draft_mcp_spec: unknown;
  build_effort_weeks: number;
  est_monthly_run_cost_usd: { low: number; high: number };
  suggested_owner_team: string;
  nearest_misses: { tool: string; reason: string }[];
};

export type Capability = {
  requirement: string;
  status: CapabilityStatus;
  matched_tool: string | null;
  justification: string;
  /** clearances the capability needs (LLM-stated); code compares these to the
   * matched tool's actual registry compliance_tags to decide RISKY */
  required_clearances: string[];
  reuse: ReuseDetails | null;
  modification_plan: ModificationPlan | null;
  risk_block: RiskBlock | null;
  build_pack: BuildPack | null;
};

export type AnalysisResult = {
  capabilities: Capability[];
  readiness_score: number;
  est_monthly_cost_usd: { low: number; high: number };
  top_blocker: string;
  verdict: "GO" | "NO-GO";
  verdict_reasoning: string;
  unblock_path: string;
  /** Present only for the orchestrator engine — the agent step trace. Additive
   * and optional; the single engine and all consumers ignore it. */
  agent_trace?: unknown;
};

// Engine return contract — shared so route dispatch is interchangeable.
export type AnalyzeSuccess = {
  ok: true;
  result: AnalysisResult;
  usage: { input_tokens: number; output_tokens: number };
};
export type AnalyzeFailure = { ok: false; error: string; httpStatus: number };
export type AnalyzeOutcome = AnalyzeSuccess | AnalyzeFailure;

export function buildToolMap(
  tools: RegistryTool[],
): Map<string, RegistryTool> {
  return new Map(tools.map((t) => [t.name, t]));
}

export function extractJson(text: string): string {
  // Strip markdown fences if the model added them despite instructions
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  // Fall back to the outermost object if there's stray prose around it
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return candidate;
  return candidate.slice(start, end + 1);
}

export function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

export function range(v: unknown): { low: number; high: number } | null {
  const o = asObject(v);
  if (!o) return null;
  const low = num(o.low);
  const high = num(o.high);
  return low !== null && high !== null ? { low, high } : null;
}

export function reuseFromRegistry(tool: RegistryTool): ReuseDetails {
  return {
    version: tool.version,
    owner_team: tool.owner_team,
    owner_contact: tool.owner_contact,
    docs_url: tool.docs_url,
    repo_path: tool.repo_path,
    compliance_tags: tool.compliance_tags,
    est_cost_per_call_usd: tool.est_cost_per_call_usd,
    stack: tool.stack ?? null,
    input_parameters: tool.input_parameters.map((p) => ({
      name: p.name,
      type: p.type,
      required: p.required ?? false,
    })),
    example_call: tool.example_call,
    example_response: tool.example_response,
  };
}

export function normalizeReuse(v: unknown): ReuseDetails | null {
  const o = asObject(v);
  if (!o) return null;
  return {
    version: str(o.version),
    owner_team: str(o.owner_team),
    owner_contact: str(o.owner_contact),
    docs_url: str(o.docs_url),
    repo_path: str(o.repo_path),
    compliance_tags: Array.isArray(o.compliance_tags)
      ? o.compliance_tags.map(String)
      : [],
    est_cost_per_call_usd: range(o.est_cost_per_call_usd),
    stack: Array.isArray(o.stack) ? o.stack.map(String) : null,
    input_parameters: Array.isArray(o.input_parameters)
      ? o.input_parameters
          .map((p) => asObject(p))
          .filter((p): p is Record<string, unknown> => p !== null)
          .map((p) => ({
            name: String(p.name ?? ""),
            type: String(p.type ?? ""),
            required: Boolean(p.required),
          }))
      : [],
    example_call: o.example_call ?? null,
    example_response: o.example_response ?? null,
  };
}

export function normalizeModificationPlan(v: unknown): ModificationPlan | null {
  const o = asObject(v);
  if (!o) return null;
  const whats_missing = str(o.whats_missing);
  const change_needed = str(o.change_needed);
  const modify_effort_days = num(o.modify_effort_days);
  const build_new_effort_weeks = num(o.build_new_effort_weeks);
  const est_savings_usd = num(o.est_savings_usd);
  if (
    !whats_missing ||
    !change_needed ||
    modify_effort_days === null ||
    build_new_effort_weeks === null ||
    est_savings_usd === null
  )
    return null;
  return {
    whats_missing,
    change_needed,
    modify_effort_days,
    build_new_effort_weeks,
    est_savings_usd,
  };
}

export function normalizeBuildPack(v: unknown): BuildPack | null {
  const o = asObject(v);
  if (!o) return null;
  const build_effort_weeks = num(o.build_effort_weeks);
  const est_monthly_run_cost_usd = range(o.est_monthly_run_cost_usd);
  const suggested_owner_team = str(o.suggested_owner_team);
  if (
    build_effort_weeks === null ||
    !est_monthly_run_cost_usd ||
    !suggested_owner_team
  )
    return null;
  return {
    draft_mcp_spec: o.draft_mcp_spec ?? null,
    build_effort_weeks,
    est_monthly_run_cost_usd,
    suggested_owner_team,
    nearest_misses: Array.isArray(o.nearest_misses)
      ? o.nearest_misses
          .map((m) => asObject(m))
          .filter((m): m is Record<string, unknown> => m !== null)
          .map((m) => ({
            tool: String(m.tool ?? ""),
            reason: String(m.reason ?? ""),
          }))
          .slice(0, 3)
      : [],
  };
}

function buildRiskBlock(
  tool: RegistryTool,
  missing: string[],
  deprecated: boolean,
): RiskBlock {
  if (missing.length > 0) {
    return {
      missing_clearance: `${missing.join(", ")}: required for the data this capability handles, absent on ${tool.name}`,
      unblock_contact: "compliance-review@meridianbank.example",
      est_unblock_time: "2 to 4 weeks for clearance review · modeled",
    };
  }
  return {
    missing_clearance: `${tool.name} is deprecated and scheduled for decommission`,
    unblock_contact: tool.owner_contact ?? "compliance-review@meridianbank.example",
    est_unblock_time: "plan migration before kickoff · modeled",
  };
}

/**
 * Deterministic PII backstop. Scans a capability's own text (requirement +
 * justification) for hardcoded sensitive-data signals and, if any is found,
 * ADDS "pii-cleared" to its required_clearances. Code can only strengthen the
 * requirement — it never removes a clearance the LLM flagged. Fail-safe: if the
 * scan throws for any reason, "pii-cleared" is added anyway (over-flag, never
 * under-flag). Runs before applyComplianceRules, which then reads the
 * possibly-strengthened required_clearances unchanged.
 */
export function deterministicPiiScan(capability: Capability): Capability {
  // Already required by the LLM — nothing to add.
  if (capability.required_clearances.includes("pii-cleared")) {
    return capability;
  }

  let touchesPii: boolean;
  try {
    const text = `${capability.requirement} ${capability.justification}`;
    touchesPii = PII_SIGNAL_PATTERNS.some((re) => re.test(text));
  } catch {
    // Fail safe: on any scan error, over-flag rather than under-flag.
    touchesPii = true;
  }

  if (!touchesPii) return capability;

  return {
    ...capability,
    required_clearances: [...capability.required_clearances, "pii-cleared"],
  };
}

/**
 * Deterministic risky decision. Code — not the LLM — owns risky/not-risky:
 * a matched tool is RISKY when a clearance the capability requires is absent
 * from the tool's registry compliance_tags, or when the tool is deprecated.
 * The LLM's justification still explains the concern, but never sets status.
 */
export function applyComplianceRules(
  cap: Capability,
  toolMap: Map<string, RegistryTool>,
): Capability {
  const tool = cap.matched_tool ? toolMap.get(cap.matched_tool) : undefined;
  if (!tool) return cap; // unresolved or "missing" — no tags to read

  const actual = new Set(tool.compliance_tags);
  const required = cap.required_clearances.filter((c) =>
    (KNOWN_CLEARANCES as readonly string[]).includes(c),
  );
  const missing = required.filter((c) => !actual.has(c));
  const deprecated = tool.status === "deprecated";

  if (missing.length > 0 || deprecated) {
    return {
      ...cap,
      status: "risky",
      risk_block: buildRiskBlock(tool, missing, deprecated),
      // risky owns the detail block; clear any functional-status blocks.
      modification_plan: null,
      build_pack: null,
    };
  }
  // No compliance gap → guarantee not-risky.
  return { ...cap, risk_block: null };
}

/**
 * The shared deterministic tail. Given the functional capabilities an engine
 * produced (statuses limited to covered/partial/missing), run the PII backstop,
 * then the compliance gate (which owns risky), then recompute the readiness
 * score from the FINAL code-decided statuses. Identical for every engine — this
 * is what makes gate accuracy structurally engine-independent.
 */
export function finalizeAndScore(
  functionalCapabilities: Capability[],
  toolMap: Map<string, RegistryTool>,
): { capabilities: Capability[]; readiness_score: number } {
  const guarded = functionalCapabilities.map(deterministicPiiScan);
  const finalCapabilities = guarded.map((c) => applyComplianceRules(c, toolMap));
  const computedScore = finalCapabilities.length
    ? Math.round(
        (100 *
          finalCapabilities.reduce(
            (sum, c) => sum + STATUS_WEIGHTS[c.status],
            0,
          )) /
          finalCapabilities.length,
      )
    : 0;
  return {
    capabilities: finalCapabilities,
    readiness_score: Math.max(0, Math.min(100, computedScore)),
  };
}
