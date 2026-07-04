import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import registryJson from "@/data/registry.json";
// Type-only import — erased at compile time, so it never triggers the Supabase
// client module to load. The runtime fetch uses a dynamic import (see POST).
import type { RegistryTool } from "@/lib/registry-source";
import { runAnalysisOrchestrated } from "@/lib/orchestrator/engine";
import { runAnalysisHolistic } from "@/lib/orchestrator/holistic";
import {
  type AnalysisResult,
  type Capability,
  type CapabilityStatus,
  type AnalyzeOutcome,
  LLM_STATUSES,
  KNOWN_CLEARANCES,
  asObject,
  range,
  extractJson,
  buildToolMap,
  reuseFromRegistry,
  normalizeReuse,
  normalizeModificationPlan,
  normalizeBuildPack,
  finalizeAndScore,
} from "@/lib/analyze-core";

// Re-export the shared types so existing consumers that import them from this
// route module keep working after the extraction into lib/analyze-core.
export type {
  AnalysisResult,
  Capability,
  ReuseDetails,
  ModificationPlan,
  RiskBlock,
  BuildPack,
  AnalyzeSuccess,
  AnalyzeFailure,
  AnalyzeOutcome,
} from "@/lib/analyze-core";

export const maxDuration = 60;

// Static fallback registry. Used whenever the live Supabase registry can't be
// read, so the demo never hard-crashes.
const staticTools = registryJson.tools as unknown as RegistryTool[];

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

/**
 * Parse and validate the single-call model response, then hand the functional
 * capabilities to the shared deterministic core (finalizeAndScore) which owns
 * the PII backstop, the compliance gate, and the readiness score.
 */
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

  // Shared deterministic core: PII backstop + compliance gate + score.
  const { capabilities: finalCapabilities, readiness_score } = finalizeAndScore(
    capabilities,
    toolMap,
  );

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
    readiness_score,
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

/**
 * Single-call analysis engine. Loads the registry (Supabase with static
 * fallback), builds the prompt, calls the model once, then runs the shared
 * deterministic core via validate(). Called by POST and directly by the eval
 * harness; the eval path skips the Supabase save so evals don't pollute the
 * memory dashboard. This is the "single" engine behind the ANALYZE_ENGINE flag.
 */
export async function runAnalysis(prd: string): Promise<AnalyzeOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: "The demo isn't configured yet: ANTHROPIC_API_KEY is not set.",
      httpStatus: 500,
    };
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

  // 8000 gives comfortable headroom for a 15-capability worst-case PRD
  // (~6,750 tokens by measured status-class averages). Anthropic bills actual
  // output tokens, not the ceiling, so this is essentially free for normal
  // calls. See eval baseline notes for the math.
  const MAX_OUTPUT_TOKENS = 8000;

  let text: string;
  let usage: { input_tokens: number; output_tokens: number };
  let stopReason: string | null = null;
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: MAX_OUTPUT_TOKENS,
      stream: false,
      system: systemPrompt,
      messages: [{ role: "user", content: `PRD to analyze:\n\n${prd}` }],
    });
    text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
    stopReason = response.stop_reason;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "The demo's API key is invalid. Check ANTHROPIC_API_KEY.", httpStatus: 500 };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "The demo is rate-limited right now. Try again in a minute.", httpStatus: 429 };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: "The analysis service had a hiccup. Try again.", httpStatus: 502 };
    }
    throw error;
  }

  // Detect truncation explicitly — distinct from malformed JSON — so the demo
  // can show a specific error and the eval harness can flag it separately.
  if (stopReason === "max_tokens") {
    console.error(
      `[analyze] response truncated at max_tokens=${MAX_OUTPUT_TOKENS}; output=${usage.output_tokens} tokens`,
    );
    console.error(`[analyze] truncated tail: ...${text.slice(-400)}`);
    return {
      ok: false,
      error:
        "The analysis response was too long and got cut off. Try a simpler or shorter PRD.",
      httpStatus: 502,
    };
  }

  let result: AnalysisResult | null = null;
  try {
    result = validate(JSON.parse(extractJson(text)), toolMap);
  } catch (e) {
    console.error(
      "[analyze] JSON parse or validation failed:",
      e instanceof Error ? e.message : e,
    );
    console.error(`[analyze] response head: ${text.slice(0, 300)}`);
    console.error(`[analyze] response tail: ${text.slice(-300)}`);
    result = null;
  }

  if (!result) {
    return {
      ok: false,
      error: "The model returned an unexpected format. Run the analysis again.",
      httpStatus: 502,
    };
  }

  return { ok: true, result, usage };
}

/**
 * Engine dispatcher. Selects the analysis engine from the ANALYZE_ENGINE env
 * var — default "single" so production is untouched; "orchestrator_p1" routes
 * to the tool-using orchestrator. Both return the same AnalyzeOutcome, so POST
 * and the eval harness are engine-agnostic. Promotion of the orchestrator to
 * default requires the eval-gated criteria in docs/orchestrator-design.md.
 */
export function analyze(prd: string): Promise<AnalyzeOutcome> {
  const engine = process.env.ANALYZE_ENGINE ?? "single";
  if (engine === "orchestrator_p1") return runAnalysisOrchestrated(prd);
  if (engine === "holistic") return runAnalysisHolistic(prd);
  return runAnalysis(prd);
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

  const outcome = await analyze(prd);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.httpStatus });
  }

  // Save to Supabase for memory — best-effort, never blocks or breaks the response.
  await saveAnalysis(prd, outcome.result);

  return NextResponse.json(outcome.result);
}
