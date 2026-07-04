/**
 * Phase A — decompose a PRD into atomic capability requirements.
 *
 * One Claude call, NO registry in the prompt. This is the step that earns the
 * ~95% recall in the single engine, kept deliberately close to it so Phase 1
 * isolates the retrieval variable rather than perturbing decomposition.
 *
 * The return shape carries `nonFunctional` from day one as the Phase 3 plug-in
 * point (latency/SLA/volume constraints that must NOT be matched as
 * capabilities — the prd_007 finding). Phase 1 leaves it empty.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { extractJson } from "@/lib/analyze-core";

export type Requirement = { id: string; text: string };

export type DecomposeResult = {
  functional: Requirement[];
  nonFunctional: string[];
  usage: { input_tokens: number; output_tokens: number };
};

const SYSTEM = `You are SpecBridge's requirement decomposer. Given a PRD, extract the FUNCTIONAL requirements and decompose them into capabilities — one distinct system action each (e.g. "search policy documents", "pull bureau credit report", "post entries to the general ledger").

Rules:
- COMPLETENESS FIRST. Every distinct action the PRD explicitly states must appear as its own capability. Do NOT drop or silently fold away a stated action — if the PRD verifies identity (KYC), screens against AML/sanctions, categorizes transactions, schedules a job, sends notifications, posts to the ledger, etc., EACH of those is its own capability. Missing a stated action is the worst error.
- MERGE ONLY DATA VARIATIONS OF THE SAME ACTION. The only thing to collapse is one action repeated across a data variation (asset, currency, direction, product). "Execute crypto trades" is ONE capability, NOT four (BTC→USD, ETH→USD, USD→BTC, USD→ETH); "Display real-time crypto prices" covers BTC and ETH together; "Post transactions to the general ledger" is one capability regardless of asset. But two DIFFERENT actions are always separate capabilities (KYC is not AML; a deposit is not a trade; categorizing is not calculating).
- RESPECT SCOPE. If the PRD explicitly marks something out of scope, or says it is handled by an existing / external / separate system, do NOT list it as a capability.
- Do NOT match tools, do NOT classify status, do NOT mention compliance. Only list the capabilities.
- Ignore non-functional constraints (latency, SLA, throughput, volume) — they are not capabilities.

Respond with ONLY a JSON array of short capability strings, no markdown fences, no prose. Example: ["Verify applicant identity via KYC", "Pull the applicant's credit report"]`;

export async function decompose(
  prd: string,
  client: Anthropic,
): Promise<DecomposeResult> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    stream: false,
    system: SYSTEM,
    messages: [{ role: "user", content: `PRD:\n\n${prd}` }],
  });
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  let functional: Requirement[] = [];
  try {
    const parsed = JSON.parse(extractJson(text));
    if (Array.isArray(parsed)) {
      functional = parsed
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((text, i) => ({ id: `r${i + 1}`, text: text.trim() }));
    }
  } catch {
    functional = [];
  }

  return {
    functional,
    nonFunctional: [], // Phase 3 populates this; Phase 1 leaves it empty
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}
