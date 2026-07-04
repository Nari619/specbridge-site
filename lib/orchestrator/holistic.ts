/**
 * holistic engine (ANALYZE_ENGINE=holistic). The #1 revisit idea from
 * docs/orchestrator-design.md §9, motivated by the Q2 diagnosis and external
 * review: orchestrator_p1's per-requirement ISOLATION destroyed cross-capability
 * context (in banking a status often depends on relationships between
 * capabilities), which the single engine keeps because it reasons over
 * everything at once.
 *
 * This variant keeps the agentic retrieval + the cost win, but restores holistic
 * judgment: decompose → BM25 retrieve per requirement → UNION+dedupe candidates
 * (~15-20 tools) → ONE holistic match call over ALL requirements + ALL candidates
 * together (like the single engine, but over a retrieved subset instead of 100
 * tools) → the SAME deterministic gate/score (analyze-core, unchanged).
 */
import Anthropic from "@anthropic-ai/sdk";
import registryJson from "@/data/registry.json";
import type { RegistryTool } from "@/lib/registry-source";
import {
  type AnalyzeOutcome,
  type AnalysisResult,
  type Capability,
  type CapabilityStatus,
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
import { createRegistryIndex, type Candidate } from "@/lib/retrieval";
import { decompose } from "./decompose";
import { createTracer } from "./trace";

const staticTools = registryJson.tools as unknown as RegistryTool[];

async function loadRegistry(): Promise<RegistryTool[]> {
  try {
    const { getRegistryTools } = await import("@/lib/registry-source");
    const fetched = await getRegistryTools();
    if (fetched.length === 0) throw new Error("Supabase returned 0 tools");
    console.log(`[holistic] live Supabase registry (${fetched.length} tools)`);
    return fetched;
  } catch (error) {
    console.error(
      "[holistic] Supabase registry unavailable — static fallback:",
      error instanceof Error ? error.message : error,
    );
    return staticTools;
  }
}

const SYSTEM = `You are SpecBridge, an engineering-readiness analyst for product managers at an enterprise. You receive a PRD, its already-extracted requirements, and a RETRIEVED SUBSET of the enterprise's internal MCP tool registry (candidate tools — a relevant subset, not the full registry). Score the PRD against the candidate tools.

Reason over ALL requirements and ALL candidates TOGETHER. A capability's fit often depends on other capabilities — an upstream gap can weaken a downstream capability, one tool may cover several requirements, and a compliance concern on one capability can matter for the whole flow. Use that cross-capability context; do not judge each requirement in isolation.

For each requirement, classify its FUNCTIONAL fit only — ignore compliance posture (compliance is decided separately, in code):
- "covered": a candidate is the RIGHT functional tool for the capability. If the candidate's description supports it, it is covered. Do NOT downgrade to "partial" for unstated specifics the description doesn't explicitly confirm (an as-of date, an asset class, a ticker, a data field) — assume a tool handles reasonable variations within its stated purpose. Do not invent requirements the PRD didn't state.
- "partial": ONLY a concrete, STATED functional gap the tool genuinely cannot meet without real modification, OR a deprecated candidate is the only functional match.
- "missing": no candidate supports the capability at all (matched_tool = null).
Do NOT output "risky" — code decides risky from the registry's compliance_tags.

For each capability: set "matched_tool" to the exact "name" of the best candidate (or null); one-line "justification"; "required_clearances" chosen ONLY from ["pii-cleared", "audit-grade"] (pii-cleared if it reads/writes personal/customer data; audit-grade if it produces a regulatory record or auditable decision; [] if neither). Attach "modification_plan" for partial {whats_missing, change_needed, modify_effort_days, build_new_effort_weeks, est_savings_usd (loaded engineer ~$1,200/day, build-week = 5 engineer-days)} and "build_pack" for missing {draft_mcp_spec, build_effort_weeks, est_monthly_run_cost_usd {low,high}, suggested_owner_team, nearest_misses (EXACTLY 3: {tool, reason})}. Never output "reuse" or "risk_block". Blocks that don't apply must be null.

Then estimate total monthly run cost {low, high} using candidate est_cost_per_call_usd and any volumes; name the single top blocker; output a verdict "GO" or "NO-GO" with one-paragraph reasoning and a concrete unblock path. All cost/effort figures are modeled plain numbers, no currency symbols.

Respond with ONLY a JSON object, no markdown fences, matching:
{
  "capabilities": [
    { "requirement": string, "status": "covered"|"partial"|"missing", "matched_tool": string|null, "justification": string, "required_clearances": string[], "modification_plan": {...}|null, "build_pack": {...}|null }
  ],
  "est_monthly_cost_usd": { "low": number, "high": number },
  "top_blocker": string,
  "verdict": "GO"|"NO-GO",
  "verdict_reasoning": string,
  "unblock_path": string
}`;

type ParsedResult = {
  capabilities: Capability[];
  est_monthly_cost_usd: { low: number; high: number };
  top_blocker: string;
  verdict: "GO" | "NO-GO";
  verdict_reasoning: string;
  unblock_path: string;
};

function parse(
  raw: unknown,
  toolMap: Map<string, RegistryTool>,
): ParsedResult | null {
  const r = asObject(raw);
  if (!r || !Array.isArray(r.capabilities) || r.capabilities.length === 0)
    return null;
  const capabilities: Capability[] = [];
  for (const item of r.capabilities) {
    const c = asObject(item);
    if (!c) continue;
    let status = String(c.status ?? "").toLowerCase();
    if (status === "risky") status = "covered";
    if (
      typeof c.requirement !== "string" ||
      typeof c.justification !== "string" ||
      !LLM_STATUSES.includes(status as (typeof LLM_STATUSES)[number])
    )
      continue;
    const matched_tool =
      typeof c.matched_tool === "string" ? c.matched_tool : null;
    const required_clearances = Array.isArray(c.required_clearances)
      ? c.required_clearances
          .map(String)
          .filter((t) => (KNOWN_CLEARANCES as readonly string[]).includes(t))
      : [];
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
      risk_block: null,
      build_pack:
        status === "missing" ? normalizeBuildPack(c.build_pack) : null,
    });
  }
  if (capabilities.length === 0) return null;
  const cost = range(r.est_monthly_cost_usd);
  const verdict = String(r.verdict ?? "").toUpperCase();
  if (!cost) return null;
  if (verdict !== "GO" && verdict !== "NO-GO") return null;
  return {
    capabilities,
    est_monthly_cost_usd: cost,
    top_blocker: String(r.top_blocker ?? ""),
    verdict,
    verdict_reasoning: String(r.verdict_reasoning ?? ""),
    unblock_path: String(r.unblock_path ?? ""),
  };
}

export async function runAnalysisHolistic(
  prd: string,
): Promise<AnalyzeOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: "The demo isn't configured yet: ANTHROPIC_API_KEY is not set.",
      httpStatus: 500,
    };
  }

  const tools = await loadRegistry();
  const toolMap = buildToolMap(tools);
  const index = createRegistryIndex(tools);
  const client = new Anthropic();
  const tracer = createTracer("holistic");
  let inTokens = 0;
  let outTokens = 0;

  try {
    // Phase A — decompose (unchanged; earns recall).
    const dec = await decompose(prd, client);
    tracer.llmCall(dec.usage);
    inTokens += dec.usage.input_tokens;
    outTokens += dec.usage.output_tokens;
    if (dec.functional.length === 0) {
      return {
        ok: false,
        error: "Couldn't extract requirements from the PRD. Try rephrasing it.",
        httpStatus: 502,
      };
    }

    // Retrieval — union + dedupe candidates across all requirements.
    const seen = new Set<string>();
    const union: Candidate[] = [];
    for (const req of dec.functional) {
      const cands = index.search(req.text, 6);
      tracer.toolCall({
        requirement_id: req.id,
        tool: "search_registry",
        args: { requirement: req.text, k: 6 },
        result_summary: cands.map((c) => ({ tool: c.tool_id, relevance: c.relevance })),
        duration_ms: 0,
      });
      for (const c of cands) {
        if (!seen.has(c.tool_id)) {
          seen.add(c.tool_id);
          union.push(c);
        }
      }
    }

    // Full detail for the unioned candidate tools (single-engine information
    // diet — including input_parameters — since holistic judgment, unlike the
    // isolated resolve, does not over-scrutinize).
    const candidateTools = union
      .map((c) => toolMap.get(c.tool_id))
      .filter((t): t is RegistryTool => !!t)
      .map((t) => ({
        name: t.name,
        description: t.description,
        category: t.category,
        input_parameters: t.input_parameters,
        compliance_tags: t.compliance_tags,
        status: t.status,
        est_cost_per_call_usd: t.est_cost_per_call_usd,
      }));

    // Phase B — ONE holistic match call over all requirements + all candidates.
    const userContent = `PRD:\n\n${prd}\n\nEXTRACTED REQUIREMENTS:\n${JSON.stringify(dec.functional.map((r) => r.text), null, 2)}\n\nCANDIDATE TOOLS (retrieved subset of the registry):\n${JSON.stringify(candidateTools, null, 2)}`;
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      stream: false,
      system: SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    tracer.llmCall({
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });
    inTokens += response.usage.input_tokens;
    outTokens += response.usage.output_tokens;

    if (response.stop_reason === "max_tokens") {
      console.error(
        `[holistic] match truncated at max_tokens; output=${response.usage.output_tokens} tokens`,
      );
      return {
        ok: false,
        error: "The analysis response was too long and got cut off. Try a simpler or shorter PRD.",
        httpStatus: 502,
      };
    }

    let parsed: ParsedResult | null = null;
    try {
      parsed = parse(JSON.parse(extractJson(text)), toolMap);
    } catch {
      parsed = null;
    }
    if (!parsed) {
      return {
        ok: false,
        error: "The model returned an unexpected format. Run the analysis again.",
        httpStatus: 502,
      };
    }

    for (const cap of parsed.capabilities) {
      tracer.decision({
        requirement_id: cap.requirement,
        chosen_tool: cap.matched_tool,
        depth: "shallow",
        functional_status: cap.status,
        rationale: cap.justification,
      });
    }

    // Shared deterministic core — the gate + score, unchanged.
    const { capabilities, readiness_score } = finalizeAndScore(
      parsed.capabilities,
      toolMap,
    );

    const result: AnalysisResult = {
      capabilities,
      readiness_score,
      est_monthly_cost_usd: parsed.est_monthly_cost_usd,
      top_blocker: parsed.top_blocker,
      verdict: parsed.verdict,
      verdict_reasoning: parsed.verdict_reasoning,
      unblock_path: parsed.unblock_path,
      agent_trace: tracer.dump(),
    };
    return {
      ok: true,
      result,
      usage: { input_tokens: inTokens, output_tokens: outTokens },
    };
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
}
