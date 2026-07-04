/**
 * Agent step trace. Records every tool call and decision the orchestrator makes
 * so an analysis is explainable and auditable — the "agent step trace" the
 * project audit found missing. Consumed by the eval harness (to debug tool
 * picks) and, later, the Evidence Pack.
 *
 * The Tracer interface is stable across phases: Phases 2/3 emit new event types
 * (verify_parameter_fit calls, deep/shallow decisions) without changing this
 * shape or its consumers.
 */

export type ToolCallEvent = {
  kind: "tool_call";
  step: number;
  requirement_id: string | null;
  tool: string;
  args: unknown;
  result_summary: unknown;
  duration_ms: number;
};

export type DecisionEvent = {
  kind: "decision";
  step: number;
  requirement_id: string;
  chosen_tool: string | null;
  depth: "shallow" | "deep";
  functional_status: string;
  rationale: string;
};

export type TraceEvent = ToolCallEvent | DecisionEvent;

export type AgentTrace = {
  engine: string;
  events: TraceEvent[];
  totals: {
    events: number;
    tool_calls: number;
    decisions: number;
    llm_calls: number;
    input_tokens: number;
    output_tokens: number;
  };
};

export type Tracer = {
  toolCall(
    e: Omit<ToolCallEvent, "kind" | "step">,
  ): void;
  decision(e: Omit<DecisionEvent, "kind" | "step">): void;
  /** Record an LLM call's token usage (decompose, resolve, later verify). */
  llmCall(usage: { input_tokens: number; output_tokens: number }): void;
  dump(): AgentTrace;
};

export function createTracer(engine: string): Tracer {
  const events: TraceEvent[] = [];
  let step = 0;
  let llmCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  return {
    toolCall(e) {
      events.push({ kind: "tool_call", step: step++, ...e });
    },
    decision(e) {
      events.push({ kind: "decision", step: step++, ...e });
    },
    llmCall(usage) {
      llmCalls++;
      inputTokens += usage.input_tokens;
      outputTokens += usage.output_tokens;
    },
    dump() {
      return {
        engine,
        events,
        totals: {
          events: events.length,
          tool_calls: events.filter((e) => e.kind === "tool_call").length,
          decisions: events.filter((e) => e.kind === "decision").length,
          llm_calls: llmCalls,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
      };
    },
  };
}
