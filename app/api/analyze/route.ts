import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import registryJson from "@/data/registry.json";
// Type-only import — erased at compile time, so it never triggers the Supabase
// client module to load. The runtime fetch uses a dynamic import (see POST).
import type { RegistryTool } from "@/lib/registry-source";

export const maxDuration = 60;

// Static fallback registry. Used whenever the live Supabase registry can't be
// read, so the demo never hard-crashes.
const staticTools = registryJson.tools as unknown as RegistryTool[];

const STATUSES = ["covered", "partial", "risky", "missing"] as const;
type CapabilityStatus = (typeof STATUSES)[number];

// "risky" is NOT assigned by the LLM. The model classifies functional fit only;
// the risky/not-risky decision is made deterministically in code from the
// registry's compliance_tags (see applyComplianceRules).
const LLM_STATUSES = ["covered", "partial", "missing"] as const;

// The only clearances code understands. A required_clearance outside this set
// is ignored, so a hallucinated tag can never trigger a risky flag.
const KNOWN_CLEARANCES = ["pii-cleared", "audit-grade"] as const;

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
};

function buildToolMap(tools: RegistryTool[]): Map<string, RegistryTool> {
  return new Map(tools.map((t) => [t.name, t]));
}

const SYSTEM_PROMPT_BODY = `You are SpecBridge, an engineering-readiness analyst for product managers at an enterprise. You receive a PRD and must score it against the enterprise's internal MCP tool registry (provided below as JSON). The registry is the complete, authoritative list of tools that exist — do not invent tools.

Follow these steps:
1. Extract the concrete requirements from the PRD.
2. Decompose them into atomic capabilities (one system action each, e.g. "search policy documents", "pull bureau credit report").
3. Match each capability against the registry and classify its FUNCTIONAL fit only — ignore compliance posture when choosing the status (compliance is decided separately, in code):
   - "covered": an active tool fully supports the capability.
   - "partial": a tool covers some of it, or a deprecated tool is the only functional match.
   - "missing": no tool in the registry supports it.
   Do NOT output "risky". Whether a match is risky is decided deterministically in code from the registry's compliance_tags — not by you.
4. For each capability: name the matched tool (registry "name" field, or null), give a one-line justification, and list "required_clearances" — the clearances the capability demands based on the data it touches. Choose ONLY from ["pii-cleared", "audit-grade"]: include "pii-cleared" if the capability reads or writes personal/customer data; include "audit-grade" if it produces a regulatory record or a decision that must be auditable. Use [] if neither applies. Your justification may explain a compliance concern, but it must not change the status.
5. Attach status-specific detail blocks (schema below). Always set "reuse" to null — reuse details are attached server-side from the registry using your matched_tool, so matched_tool must be the exact registry "name". Never copy registry fields into the output.
   - covered: no extra block.
   - partial: include "modification_plan": whats_missing (the gap at parameter level, e.g. "no theme/category parameter on input"), change_needed (the concrete change), modify_effort_days (number), build_new_effort_weeks (number), est_savings_usd (number — savings of modifying vs building new; assume a fully-loaded engineer costs ~$1,200/day and a build-week is 5 engineer-days).
   - missing: include "build_pack": draft_mcp_spec (a draft registry entry JSON for the new tool: name, description, input_parameters, suggested compliance_tags), build_effort_weeks (number), est_monthly_run_cost_usd ({low, high} at the PRD's stated volume), suggested_owner_team (an existing team from the registry), nearest_misses (EXACTLY 3 entries: {tool: registry tool name, reason: one line on why it doesn't fit}).
   Do NOT output a "risk_block" — code builds it when it decides a capability is risky. Blocks that don't apply to a status must be null.
6. Compute an overall readiness_score from 0-100 weighting covered=1, partial=0.5, risky=0.35, missing=0.
7. Estimate total monthly run cost as a low-high USD range using the registry's est_cost_per_call_usd and any volume figures in the PRD.
8. Name the single top blocker.
9. Output a verdict: "GO" if the team can start building now with manageable gaps, "NO-GO" if a blocker must be resolved first, with one-paragraph reasoning and a concrete unblock path (who to talk to, what to clear or build first).

All cost and effort figures are modeled estimates — output plain numbers, no ranges-as-strings, no currency symbols.

Respond with ONLY a JSON object — no markdown fences, no prose before or after — matching exactly this schema:
{
  "capabilities": [
    {
      "requirement": string,
      "status": "covered" | "partial" | "missing",
      "matched_tool": string | null,
      "justification": string,
      "required_clearances": string[],
      "reuse": null,
      "modification_plan": {
        "whats_missing": string, "change_needed": string,
        "modify_effort_days": number, "build_new_effort_weeks": number,
        "est_savings_usd": number
      } | null,
      "build_pack": {
        "draft_mcp_spec": object, "build_effort_weeks": number,
        "est_monthly_run_cost_usd": { "low": number, "high": number },
        "suggested_owner_team": string,
        "nearest_misses": [{ "tool": string, "reason": string }]
      } | null
    }
  ],
  "readiness_score": number,
  "est_monthly_cost_usd": { "low": number, "high": number },
  "top_blocker": string,
  "verdict": "GO" | "NO-GO",
  "verdict_reasoning": string,
  "unblock_path": string
}`;

/** Build the full system prompt by appending the active tool registry. */
function buildSystemPrompt(tools: RegistryTool[]): string {
  return `${SYSTEM_PROMPT_BODY}\n\nTOOL REGISTRY:\n${JSON.stringify({ tools }, null, 2)}`;
}

function extractJson(text: string): string {
  // Strip markdown fences if the model added them despite instructions
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  // Fall back to the outermost object if there's stray prose around it
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return candidate;
  return candidate.slice(start, end + 1);
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function range(v: unknown): { low: number; high: number } | null {
  const o = asObject(v);
  if (!o) return null;
  const low = num(o.low);
  const high = num(o.high);
  return low !== null && high !== null ? { low, high } : null;
}

function reuseFromRegistry(tool: RegistryTool): ReuseDetails {
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

function normalizeReuse(v: unknown): ReuseDetails | null {
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

function normalizeModificationPlan(v: unknown): ModificationPlan | null {
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

function normalizeBuildPack(v: unknown): BuildPack | null {
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
 * Deterministic risky decision. Code — not the LLM — owns risky/not-risky:
 * a matched tool is RISKY when a clearance the capability requires is absent
 * from the tool's registry compliance_tags, or when the tool is deprecated.
 * The LLM's justification still explains the concern, but never sets status.
 */
function applyComplianceRules(
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

function validate(
  raw: unknown,
  toolMap: Map<string, RegistryTool>,
): AnalysisResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.capabilities) || r.capabilities.length === 0)
    return null;

  const capabilities: Capability[] = [];
  for (const item of r.capabilities) {
    const c = asObject(item);
    if (!c) return null;
    let status = String(c.status ?? "").toLowerCase();
    // The LLM should emit functional statuses only. If it slips and says
    // "risky", treat the functional fit as "covered" and let the deterministic
    // pass re-decide from the registry tags.
    if (status === "risky") status = "covered";
    if (
      typeof c.requirement !== "string" ||
      typeof c.justification !== "string" ||
      !LLM_STATUSES.includes(status as (typeof LLM_STATUSES)[number])
    )
      return null;

    const matched_tool =
      typeof c.matched_tool === "string" ? c.matched_tool : null;

    const required_clearances = Array.isArray(c.required_clearances)
      ? c.required_clearances
          .map(String)
          .filter((t) => (KNOWN_CLEARANCES as readonly string[]).includes(t))
      : [];

    // Registry is the source of truth for reuse facts; the model's copy is a
    // fallback for tools we can't resolve.
    const registryTool = matched_tool ? toolMap.get(matched_tool) : undefined;
    const reuse =
      status === "missing"
        ? null
        : registryTool
          ? reuseFromRegistry(registryTool)
          : normalizeReuse(c.reuse);

    capabilities.push({
      requirement: c.requirement,
      status: status as CapabilityStatus,
      matched_tool,
      justification: c.justification,
      required_clearances,
      reuse,
      modification_plan:
        status === "partial"
          ? normalizeModificationPlan(c.modification_plan)
          : null,
      risk_block: null, // code decides risky and builds this block below
      build_pack:
        status === "missing" ? normalizeBuildPack(c.build_pack) : null,
    });
  }

  // Deterministic risky decision happens here — not in the LLM.
  const finalCapabilities = capabilities.map((c) =>
    applyComplianceRules(c, toolMap),
  );

  // Recompute the readiness score from the FINAL (code-decided) statuses so the
  // score can't disagree with the rows the user sees.
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

  const cost = range(r.est_monthly_cost_usd);
  const verdict = String(r.verdict ?? "").toUpperCase();
  if (!cost) return null;
  if (verdict !== "GO" && verdict !== "NO-GO") return null;

  // TODO: verdict/top_blocker are LLM prose generated in the same pass as the
  // matches, BEFORE the deterministic risky rules run, so a code-flipped risky
  // row isn't reflected in the GO/NO-GO sentence. Making the verdict consistent
  // with the final statuses needs a second LLM pass (or a deterministic verdict)
  // conditioned on finalCapabilities — deferred to avoid a second round-trip on
  // this latency-sensitive route.

  return {
    capabilities: finalCapabilities,
    readiness_score: Math.max(0, Math.min(100, computedScore)),
    est_monthly_cost_usd: cost,
    top_blocker: String(r.top_blocker ?? ""),
    verdict,
    verdict_reasoning: String(r.verdict_reasoning ?? ""),
    unblock_path: String(r.unblock_path ?? ""),
  };
}

/** Derive a short title from the PRD: first non-empty line, capped to ~6 words. */
function deriveTitle(prd: string): string {
  const firstLine = prd
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "Untitled analysis";
  const words = firstLine.split(/\s+/);
  const short = words.slice(0, 6).join(" ");
  return words.length > 6 ? `${short}…` : short;
}

/**
 * Persist a completed analysis to the Supabase "analyses" table for memory.
 * Best-effort and fully isolated: any failure (including a missing-env import
 * crash) is caught and logged so the user's analysis is never blocked or
 * broken by the save. Awaited so the insert completes before the serverless
 * function returns (a fire-and-forget insert can be dropped when the function
 * freezes).
 */
async function saveAnalysis(
  prdText: string,
  result: AnalysisResult,
): Promise<void> {
  try {
    const { supabase } = await import("@/lib/supabase");

    const counts = { covered: 0, partial: 0, risky: 0, missing: 0 };
    for (const c of result.capabilities) counts[c.status] += 1;

    const savings_estimate = result.capabilities.reduce(
      (sum, c) => sum + (c.modification_plan?.est_savings_usd ?? 0),
      0,
    );

    const { error } = await supabase.from("analyses").insert({
      prd_text: prdText,
      prd_title: deriveTitle(prdText),
      readiness_score: result.readiness_score,
      verdict: result.verdict,
      covered_count: counts.covered,
      partial_count: counts.partial,
      risky_count: counts.risky,
      missing_count: counts.missing,
      est_monthly_cost_low: result.est_monthly_cost_usd.low,
      est_monthly_cost_high: result.est_monthly_cost_usd.high,
      savings_estimate,
      full_result: result,
    });

    if (error) {
      console.error("[analyze] failed to save analysis:", error.message);
    } else {
      console.log("[analyze] saved analysis to Supabase");
    }
  } catch (e) {
    console.error(
      "[analyze] save step failed, returning the analysis anyway:",
      e instanceof Error ? e.message : e,
    );
  }
}

export async function POST(request: Request) {
  let prd: unknown;
  try {
    ({ prd } = await request.json());
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON with a `prd` field." },
      { status: 400 },
    );
  }

  if (typeof prd !== "string" || prd.trim().length < 40) {
    return NextResponse.json(
      { error: "Paste a PRD of at least a few sentences to analyze." },
      { status: 400 },
    );
  }
  if (prd.length > 12000) {
    return NextResponse.json(
      { error: "PRD is too long for the demo. Keep it under 12,000 characters." },
      { status: 400 },
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The demo isn't configured yet: ANTHROPIC_API_KEY is not set." },
      { status: 500 },
    );
  }

  // Read the live registry from Supabase. The dynamic import keeps the Supabase
  // client out of this module's static graph, so even a configuration error
  // (e.g. missing env vars) is caught here and falls back to the static
  // registry — the demo never hard-crashes on a registry problem.
  let tools: RegistryTool[];
  try {
    const { getRegistryTools } = await import("@/lib/registry-source");
    const fetched = await getRegistryTools();
    if (fetched.length === 0) throw new Error("Supabase returned 0 tools");
    tools = fetched;
    console.log(`[analyze] using live Supabase registry (${tools.length} tools)`);
  } catch (error) {
    console.error(
      "[analyze] Supabase registry unavailable — falling back to static registry.json:",
      error instanceof Error ? error.message : error,
    );
    tools = staticTools;
  }

  const toolMap = buildToolMap(tools);
  const systemPrompt = buildSystemPrompt(tools);

  const client = new Anthropic();

  let text: string;
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      stream: false,
      system: systemPrompt,
      messages: [{ role: "user", content: `PRD to analyze:\n\n${prd}` }],
    });
    text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "The demo's API key is invalid. Check ANTHROPIC_API_KEY." },
        { status: 500 },
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "The demo is rate-limited right now. Try again in a minute." },
        { status: 429 },
      );
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: "The analysis service had a hiccup. Try again." },
        { status: 502 },
      );
    }
    throw error;
  }

  let result: AnalysisResult | null = null;
  try {
    result = validate(JSON.parse(extractJson(text)), toolMap);
  } catch {
    result = null;
  }

  if (!result) {
    return NextResponse.json(
      { error: "The model returned an unexpected format. Run the analysis again." },
      { status: 502 },
    );
  }

  // Save to Supabase for memory — best-effort, never blocks or breaks the response.
  await saveAnalysis(prd, result);

  return NextResponse.json(result);
}
