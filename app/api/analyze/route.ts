import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import registry from "@/data/registry.json";

export const maxDuration = 60;

const STATUSES = ["covered", "partial", "risky", "missing"] as const;
type CapabilityStatus = (typeof STATUSES)[number];

export type ReuseDetails = {
  version: string | null;
  owner_team: string | null;
  owner_contact: string | null;
  docs_url: string | null;
  repo_path: string | null;
  compliance_tags: string[];
  est_cost_per_call_usd: { low: number; high: number } | null;
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

type RegistryTool = (typeof registry.tools)[number];
const toolMap = new Map<string, RegistryTool>(
  registry.tools.map((t) => [t.name, t]),
);

const SYSTEM_PROMPT = `You are SpecBridge, an engineering-readiness analyst for product managers at a bank. You receive a PRD and must score it against the bank's internal MCP tool registry (provided below as JSON). The registry is the complete, authoritative list of tools that exist — do not invent tools.

Follow these steps:
1. Extract the concrete requirements from the PRD.
2. Decompose them into atomic capabilities (one system action each, e.g. "search policy documents", "pull bureau credit report").
3. Match each capability against the registry and classify it:
   - "covered": an active tool fully supports it, with compliance tags appropriate to the use (e.g. a capability touching personal data needs "pii-cleared"; a regulatory record needs "audit-grade").
   - "partial": a tool covers some of it, or a deprecated tool is the only match.
   - "risky": a tool exists and functionally fits, but its compliance posture doesn't match the use (e.g. handles PII without "pii-cleared") or it is deprecated/being decommissioned.
   - "missing": no tool in the registry supports it.
4. For each capability, name the matched tool (registry "name" field, or null) and give a one-line justification.
5. Attach status-specific detail blocks (schema below):
   - covered: include "reuse" — copy version, owner_team, owner_contact, docs_url, repo_path, compliance_tags, est_cost_per_call_usd, input_parameters, example_call, and example_response VERBATIM from the matched registry entry.
   - partial: include "reuse" (same as covered) PLUS "modification_plan": whats_missing (the gap at parameter level, e.g. "no theme/category parameter on input"), change_needed (the concrete change), modify_effort_days (number), build_new_effort_weeks (number), est_savings_usd (number — savings of modifying vs building new; assume a fully-loaded engineer costs ~$1,200/day and a build-week is 5 engineer-days).
   - risky: include "reuse" (same as covered) PLUS "risk_block": missing_clearance (which clearance/tag is missing and why it matters), unblock_contact (the owning team's contact email from the registry, or "compliance-review@meridianbank.example" for clearance questions), est_unblock_time (e.g. "2–4 weeks for PII clearance review").
   - missing: include "build_pack": draft_mcp_spec (a draft registry entry JSON for the new tool: name, description, input_parameters, suggested compliance_tags), build_effort_weeks (number), est_monthly_run_cost_usd ({low, high} at the PRD's stated volume), suggested_owner_team (an existing team from the registry), nearest_misses (EXACTLY 3 entries: {tool: registry tool name, reason: one line on why it doesn't fit}).
   Blocks that don't apply to a status must be null.
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
      "status": "covered" | "partial" | "risky" | "missing",
      "matched_tool": string | null,
      "justification": string,
      "reuse": {
        "version": string, "owner_team": string, "owner_contact": string,
        "docs_url": string, "repo_path": string, "compliance_tags": string[],
        "est_cost_per_call_usd": { "low": number, "high": number },
        "input_parameters": [{ "name": string, "type": string, "required": boolean }],
        "example_call": object, "example_response": object
      } | null,
      "modification_plan": {
        "whats_missing": string, "change_needed": string,
        "modify_effort_days": number, "build_new_effort_weeks": number,
        "est_savings_usd": number
      } | null,
      "risk_block": {
        "missing_clearance": string, "unblock_contact": string, "est_unblock_time": string
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
}

TOOL REGISTRY:
${JSON.stringify(registry, null, 2)}`;

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

function normalizeRiskBlock(v: unknown): RiskBlock | null {
  const o = asObject(v);
  if (!o) return null;
  const missing_clearance = str(o.missing_clearance);
  const unblock_contact = str(o.unblock_contact);
  const est_unblock_time = str(o.est_unblock_time);
  if (!missing_clearance || !unblock_contact || !est_unblock_time) return null;
  return { missing_clearance, unblock_contact, est_unblock_time };
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

function validate(raw: unknown): AnalysisResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.capabilities) || r.capabilities.length === 0)
    return null;

  const capabilities: Capability[] = [];
  for (const item of r.capabilities) {
    const c = asObject(item);
    if (!c) return null;
    const status = String(c.status ?? "").toLowerCase();
    if (
      typeof c.requirement !== "string" ||
      typeof c.justification !== "string" ||
      !STATUSES.includes(status as CapabilityStatus)
    )
      return null;

    const matched_tool =
      typeof c.matched_tool === "string" ? c.matched_tool : null;

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
      reuse,
      modification_plan:
        status === "partial"
          ? normalizeModificationPlan(c.modification_plan)
          : null,
      risk_block: status === "risky" ? normalizeRiskBlock(c.risk_block) : null,
      build_pack:
        status === "missing" ? normalizeBuildPack(c.build_pack) : null,
    });
  }

  const cost = range(r.est_monthly_cost_usd);
  const score = num(r.readiness_score);
  const verdict = String(r.verdict ?? "").toUpperCase();
  if (score === null || !cost) return null;
  if (verdict !== "GO" && verdict !== "NO-GO") return null;

  return {
    capabilities,
    readiness_score: Math.max(0, Math.min(100, Math.round(score))),
    est_monthly_cost_usd: cost,
    top_blocker: String(r.top_blocker ?? ""),
    verdict,
    verdict_reasoning: String(r.verdict_reasoning ?? ""),
    unblock_path: String(r.unblock_path ?? ""),
  };
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
      { error: "PRD is too long for the demo — keep it under 12,000 characters." },
      { status: 400 },
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "The demo isn't configured yet: ANTHROPIC_API_KEY is not set." },
      { status: 500 },
    );
  }

  const client = new Anthropic();

  let text: string;
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
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
        { error: "The demo is rate-limited right now — try again in a minute." },
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
    result = validate(JSON.parse(extractJson(text)));
  } catch {
    result = null;
  }

  if (!result) {
    return NextResponse.json(
      { error: "The model returned an unexpected format. Run the analysis again." },
      { status: 502 },
    );
  }

  return NextResponse.json(result);
}
