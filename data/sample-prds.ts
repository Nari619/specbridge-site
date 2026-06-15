export type SamplePrd = {
  id: string;
  title: string;
  body: string;
};

export const samplePrds: SamplePrd[] = [
  {
    id: "refund-processing",
    title: "Refund Processing Agent",
    body: `We want an agent that evaluates and executes customer refund requests end to end. When a customer disputes a charge, the agent checks the refund against our policy documents, pulls the relevant transaction history to confirm the charge, and verifies the customer's identity and profile before acting.

If the request is within policy, the agent issues the refund as a transfer back to the customer's account, logs the full decision to the regulatory audit trail, and notifies the customer via the secure inbox. Anything outside policy or above a value threshold is routed to a human reviewer rather than auto-approved.

Every refund touches customer money and personal data, so the whole flow must be audit-grade and handle PII appropriately.

Volume forecast: ~18,000 refunds/month. This is the highest-volume agent in the fleet, so per-task run cost matters a lot.`,
  },
  {
    id: "ai-banking-assistant",
    title: "AI Banking Assistant",
    body: `We're building an in-app AI assistant for retail customers. Customers ask natural-language questions and the assistant answers grounded in our internal policy and procedure documents, fees, dispute timelines, overdraft rules, with citations to the source document.

The assistant must also handle account-specific questions: current balance, recent transactions, and whether the customer is eligible for products like the FlexSave account or a personal line of credit, using a no-footprint pre-check.

To personalize responses, the assistant needs the customer's profile and product holdings at session start. Every assistant interaction, question, retrieved context, answer, must be written to the regulatory audit trail. When the assistant can't help, it should open a support ticket on the customer's behalf and confirm via the secure inbox.

Target: 60% self-service resolution, launch in Q3.`,
  },
  {
    id: "instant-loan-decisioning",
    title: "Instant Loan Decisioning",
    body: `Today a personal loan decision takes 2 to 4 days. We want a real-time flow: a customer applies in-app and gets a decision in under 60 seconds.

The flow: run the internal eligibility pre-check, then a soft-pull credit report from the bureau, then an affordability assessment combining bureau data with the customer's transaction history. Approved applications get a priced, expiring offer generated immediately. Every decision needs fraud screening on the application payload and a full audit-trail record for the regulator.

Two further requirements: applicants must be able to e-sign the loan agreement in-app to complete drawdown, and we want income verification via open-banking data for thin-file applicants rather than payslip uploads.

Volume forecast: 40,000 applications/month at steady state. Decision logic itself is owned by Credit Risk; this PRD covers the orchestration.`,
  },
  {
    id: "customer-feedback-triage",
    title: "Customer Feedback Triage Agent",
    body: `Support receives ~25,000 pieces of unstructured feedback monthly across app-store reviews, NPS verbatims, and inbound emails. Today triage is manual and takes days.

We want an agent that ingests each item, classifies sentiment and theme (fees, app bugs, fraud concerns, service complaints), and detects urgent items, potential fraud reports or vulnerable-customer signals, for immediate escalation.

For urgent items, the agent should pull the customer's open support cases for context, create a correctly prioritized ticket, and notify the customer via secure message that we're on it. Suspected fraud mentions should be filed to the financial-crime case queue automatically.

We also need theme-level trend reporting, week-over-week movement by category, feeding a dashboard for the product team. SMS acknowledgment for customers without the app was requested by Ops but is negotiable.`,
  },
];
