/**
 * orchestrator_p1 engine. Same return contract as the single engine
 * (AnalyzeOutcome), so route dispatch is interchangeable behind ANALYZE_ENGINE.
 *
 * Flow: decompose (1 call) → per-requirement BM25 retrieval (deterministic) →
 * resolve over candidates (1 call) → shared finalizeAndScore (the gate + score,
 * UNCHANGED) → assemble. The gate is never in the agent's control surface.
 */
import Anthropic from "@anthropic-ai/sdk";
import registryJson from "@/data/registry.json";
import type { RegistryTool } from "@/lib/registry-source";
import {
  type AnalyzeOutcome,
  type AnalysisResult,
  buildToolMap,
  finalizeAndScore,
} from "@/lib/analyze-core";
import { createRegistryIndex, type Candidate } from "@/lib/retrieval";
import { decompose } from "./decompose";
import { resolveRequirements } from "./resolve";
import { createTracer } from "./trace";

const staticTools = registryJson.tools as unknown as RegistryTool[];

async function loadRegistry(): Promise<RegistryTool[]> {
  try {
    const { getRegistryTools } = await import("@/lib/registry-source");
    const fetched = await getRegistryTools();
    if (fetched.length === 0) throw new Error("Supabase returned 0 tools");
    console.log(`[orchestrator_p1] live Supabase registry (${fetched.length} tools)`);
    return fetched;
  } catch (error) {
    console.error(
      "[orchestrator_p1] Supabase registry unavailable — static fallback:",
      error instanceof Error ? error.message : error,
    );
    return staticTools;
  }
}

export async function runAnalysisOrchestrated(
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
  const tracer = createTracer("orchestrator_p1");

  let inTokens = 0;
  let outTokens = 0;

  try {
    // Phase A — decompose.
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

    // Retrieval — deterministic BM25 per requirement.
    const candidatesByReq = new Map<string, Candidate[]>();
    for (const req of dec.functional) {
      const t0 = Date.now();
      const candidates = index.search(req.text, 6);
      candidatesByReq.set(req.id, candidates);
      tracer.toolCall({
        requirement_id: req.id,
        tool: "search_registry",
        args: { requirement: req.text, k: 6 },
        result_summary: candidates.map((c) => ({ tool: c.tool_id, relevance: c.relevance })),
        duration_ms: Date.now() - t0,
      });
    }

    // Phase B — resolve over candidates (one call).
    const { parsed, usage } = await resolveRequirements(
      dec.functional,
      candidatesByReq,
      toolMap,
      client,
    );
    tracer.llmCall(usage);
    inTokens += usage.input_tokens;
    outTokens += usage.output_tokens;
    if (!parsed) {
      return {
        ok: false,
        error: "The model returned an unexpected format. Run the analysis again.",
        httpStatus: 502,
      };
    }

    // Record per-requirement decisions into the trace.
    for (const cap of parsed.capabilities) {
      tracer.decision({
        requirement_id: cap.requirement,
        chosen_tool: cap.matched_tool,
        depth: "shallow", // Phase 1 is single-pass; deep/shallow arrives in Phase 3
        functional_status: cap.status,
        rationale: cap.justification,
      });
    }

    // Shared deterministic core — the gate + score. Identical to the single
    // engine; the agent never touches it.
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
