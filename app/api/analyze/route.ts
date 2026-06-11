import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import registry from "@/data/registry.json";

export const maxDuration = 60;

const STATUSES = ["covered", "partial", "risky", "missing"] as const;
type CapabilityStatus = (typeof STATUSES)[number];

export type AnalysisResult = {
  capabilities: {
    requirement: string;
    status: CapabilityStatus;
    matched_tool: string | null;
    justification: string;
  }[];
  readiness_score: number;
  est_monthly_cost_usd: { low: number; high: number };
  top_blocker: string;
  verdict: "GO" | "NO-GO";
  verdict_reasoning: string;
  unblock_path: string;
};

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
5. Compute an overall readiness_score from 0-100 weighting covered=1, partial=0.5, risky=0.35, missing=0.
6. Estimate monthly run cost as a low-high USD range using the registry's est_cost_per_call_usd and any volume figures in the PRD (state reasonable call-volume assumptions to yourself; output only the numbers).
7. Name the single top blocker.
8. Output a verdict: "GO" if the team can start building now with manageable gaps, "NO-GO" if a blocker must be resolved first, with one-paragraph reasoning and a concrete unblock path (who to talk to, what to clear or build first).

Respond with ONLY a JSON object — no markdown fences, no prose before or after — matching exactly this schema:
{
  "capabilities": [
    { "requirement": string, "status": "covered" | "partial" | "risky" | "missing", "matched_tool": string | null, "justification": string }
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

function validate(raw: unknown): AnalysisResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.capabilities) || r.capabilities.length === 0)
    return null;

  const capabilities: AnalysisResult["capabilities"] = [];
  for (const item of r.capabilities) {
    if (typeof item !== "object" || item === null) return null;
    const c = item as Record<string, unknown>;
    const status = String(c.status ?? "").toLowerCase();
    if (
      typeof c.requirement !== "string" ||
      typeof c.justification !== "string" ||
      !STATUSES.includes(status as CapabilityStatus)
    )
      return null;
    capabilities.push({
      requirement: c.requirement,
      status: status as CapabilityStatus,
      matched_tool: typeof c.matched_tool === "string" ? c.matched_tool : null,
      justification: c.justification,
    });
  }

  const cost = r.est_monthly_cost_usd as Record<string, unknown> | undefined;
  const low = Number(cost?.low);
  const high = Number(cost?.high);
  const score = Number(r.readiness_score);
  const verdict = String(r.verdict ?? "").toUpperCase();
  if (!Number.isFinite(score) || !Number.isFinite(low) || !Number.isFinite(high))
    return null;
  if (verdict !== "GO" && verdict !== "NO-GO") return null;

  return {
    capabilities,
    readiness_score: Math.max(0, Math.min(100, Math.round(score))),
    est_monthly_cost_usd: { low, high },
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
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
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
