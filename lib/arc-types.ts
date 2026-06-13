export type Contract = {
  agent_name: string;
  task_type: string;
  max_cost_per_task_usd: number;
  daily_fleet_ceiling_usd: number;
  escalation_rule: string;
  regulatory_tags: string[];
  /** what one completed task is worth to the business; "unknown" if uninstrumented */
  business_value_per_task_usd: number | "unknown";
  /** SpecBridge's design-time per-task run-cost estimate for this feature */
  specbridge_estimate_usd: number;
};

export type SessionOutcome = "success" | "failure" | "aborted";

export type AgentSession = {
  id: string;
  agent_name: string;
  task_type: string;
  api_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  retries: number;
  started_at: string; // ISO 8601
  ended_at: string; // ISO 8601
  outcome: SessionOutcome;
};

export type InterventionType = "warn" | "throttle" | "stop";

export type InterventionScope = "task" | "fleet";

export type Intervention = {
  id: string;
  type: InterventionType;
  scope: InterventionScope;
  agent_name: string;
  /** session that triggered the threshold crossing */
  session_id: string;
  /** agent_name of the contract this intervention enforces */
  contract_ref: string;
  threshold_pct: 80 | 95 | 100;
  /** the exact rule text that fired — for the future Evidence Pack */
  rule_text: string;
  reason: string;
  timestamp: string; // ISO 8601
};
