/**
 * Phase B (Phase 1 form) — resolve all requirements in ONE call over their
 * pre-retrieved candidate tools, instead of the whole 100-tool registry.
 *
 * Narrowing each requirement to ~6 relevant candidates is the precision lever.
 * The model assigns FUNCTIONAL status only (covered/partial/missing) and a
 * matched_tool chosen from that requirement's candidates; the deterministic gate
 * (finalizeAndScore, called by the engine afterwards) owns risky. This module
 * parses its own response with the shared analyze-core helpers so the verified
 * single-engine validate() stays untouched.
 *
 * The `hooks` param is the Phase 2 plug-in point (a verify_parameter_fit
 * verifier); Phase 1 ignores it. Phase 3 swaps the single call inside for a
 * per-requirement deep/shallow loop behind this same signature.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { RegistryTool } from "@/lib/registry-source";
import type { Requirement } from "./decompose";
import type { Candidate } from "@/lib/retrieval";
import {
  type Capability,
  type CapabilityStatus,
  LLM_STATUSES,
  KNOWN_CLEARANCES,
  asObject,
  range,
  extractJson,
  reuseFromRegistry,
  normalizeReuse,
  normalizeModificationPlan,
  normalizeBuildPack,
} from "@/lib/analyze-core";

export type ResolveHooks = {
  // Phase 2: verifier?: (req, tool) => Promise<FitResult>
  verifier?: unknown;
};

export type ParsedResolve = {
  capabilities: Capability[]; // functional (pre-gate)
  est_monthly_cost_usd: { low: number; high: number };
  top_blocker: string;
  verdict: "GO" | "NO-GO";
  verdict_reasoning: string;
  unblock_path: string;
};

export type ResolveResult = {
  parsed: ParsedResolve | null;
  usage: { input_tokens: number; output_tokens: number };
};

const SYSTEM = `You are SpecBridge, an engineering-readiness analyst. You are given a list of already-decomposed capability requirements, and for EACH requirement a short list of candidate tools retrieved from the enterprise's internal MCP registry. Match each requirement to the best candidate and classify its FUNCTIONAL fit only.

Rules:
- For each requirement, choose "matched_tool" as the exact "name" of the best-fitting candidate FROM THAT REQUIREMENT'S candidate list, or null if none of its candidates fit.
- Classify FUNCTIONAL status only — ignore compliance posture (compliance is decided separately, in code):
  - "covered": a candidate is the RIGHT functional tool for this capability. If the candidate's description supports the capability, it is covered. Do NOT downgrade to "partial" for unstated specifics the description doesn't explicitly confirm (e.g. an as-of date, a specific asset class, a particular ticker, a data field) — assume a tool handles reasonable variations within its stated purpose. Do not invent requirements the capability didn't state.
  - "partial": ONLY when there is a concrete, STATED functional gap the tool genuinely cannot meet without real modification (e.g. the capability needs a per-customer category override the tool clearly lacks), OR a deprecated candidate is the only functional match. A vague "the description doesn't confirm X" is NOT a partial — that's covered.
  - "missing": none of the candidates support the capability at all (matched_tool = null).
  Do NOT output "risky" — code decides risky from the registry's compliance_tags.
- "required_clearances": choose ONLY from ["pii-cleared", "audit-grade"]. Include "pii-cleared" if the capability reads or writes personal/customer data; include "audit-grade" if it produces a regulatory record or an auditable decision. [] if neither.
- Detail blocks: for "partial" include "modification_plan" {whats_missing, change_needed, modify_effort_days, build_new_effort_weeks, est_savings_usd (assume a loaded engineer ~$1,200/day, a build-week = 5 engineer-days)}. For "missing" include "build_pack" {draft_mcp_spec, build_effort_weeks, est_monthly_run_cost_usd {low,high}, suggested_owner_team, nearest_misses (EXACTLY 3: {tool, reason})}. Never output "reuse" or "risk_block" — set them by omission. Blocks that don't apply must be null.
- Then: estimate total monthly run cost {low, high} using candidate est_cost_per_call_usd and any volumes; name the single top blocker; output a verdict "GO" or "NO-GO" with one-paragraph reasoning and a concrete unblock path.

All cost/effort figures are modeled numbers — plain numbers, no currency symbols.

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

/** Build the compact candidate payload the model reasons over. */
function buildPayload(
  requirements: Requirement[],
  candidatesByReq: Map<string, Candidate[]>,
  toolMap: Map<string, RegistryTool>,
) {
  return requirements.map((req) => ({
    requirement_id: req.id,
    requirement: req.text,
    candidates: (candidatesByReq.get(req.id) ?? []).map((cand) => {
      const t = toolMap.get(cand.tool_id);
      if (!t) return { name: cand.name };
      // Deliberately NO input_parameters here: showing the full schema made
      // resolve nitpick fit at parameter grain and over-downgrade covered→partial
      // (see the trace diagnosis). Same information diet as the single engine —
      // name/description/category/tags/status. Parameter-fit is a deliberate
      // Phase 2 step, not an accidental resolve behavior.
      return {
        name: t.name,
        description: t.description,
        category: t.category,
        compliance_tags: t.compliance_tags,
        status: t.status,
        est_cost_per_call_usd: t.est_cost_per_call_usd,
      };
    }),
  }));
}

/** Parse the resolve response into functional capabilities + result fields. */
function parse(
  raw: unknown,
  toolMap: Map<string, RegistryTool>,
): ParsedResolve | null {
  const r = asObject(raw);
  if (!r || !Array.isArray(r.capabilities) || r.capabilities.length === 0)
    return null;

  const capabilities: Capability[] = [];
  for (const item of r.capabilities) {
    const c = asObject(item);
    if (!c) continue; // skip malformed rows rather than failing the whole PRD
    let status = String(c.status ?? "").toLowerCase();
    if (status === "risky") status = "covered"; // code owns risky
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

export async function resolveRequirements(
  requirements: Requirement[],
  candidatesByReq: Map<string, Candidate[]>,
  toolMap: Map<string, RegistryTool>,
  client: Anthropic,
  _hooks?: ResolveHooks, // Phase 2 plug-in point; unused in Phase 1
): Promise<ResolveResult> {
  const payload = buildPayload(requirements, candidatesByReq, toolMap);
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    stream: false,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Requirements with candidate tools:\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };

  let parsed: ParsedResolve | null = null;
  try {
    parsed = parse(JSON.parse(extractJson(text)), toolMap);
  } catch {
    parsed = null;
  }
  return { parsed, usage };
}
