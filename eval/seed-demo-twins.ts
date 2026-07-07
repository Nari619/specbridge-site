/**
 * Seed the two demo twin-catcher pairs into the Supabase analyses table so the
 * live demo's "similar PRD detected" moment never depends on unrecoverable rows.
 * Idempotent: skips any PRD whose exact text is already present.
 *
 * These are the "other team already scoped this" PRDs — analyzing a fraud or a
 * personal-loan PRD in the demo will then flag one of these as a near-duplicate.
 * Their texts mirror the calibration fixtures (eval/calibrate-similarity.ts).
 *
 * Run (only needed if the analyses table was cleared):
 *   npx tsx --env-file=.env.local eval/seed-demo-twins.ts
 */
import { createClient } from "@supabase/supabase-js";
import { analyze } from "@/app/api/analyze/route";
import type { AnalysisResult } from "@/lib/analyze-core";

const DEMO_TWINS = [
  {
    label: "fraud twin (Risk-Ops team)",
    prd_text:
      "The Risk Operations team is adding real-time fraud detection to our card platform. At each card authorization we score the transaction for fraud risk, fingerprint the device, and evaluate session risk signals, monitoring for suspicious patterns across accounts. When a transaction looks fraudulent we place a hold and alert the cardholder. Must decision within 200ms. Volume: ~10 million authorizations per day.",
  },
  {
    label: "lending twin (Consumer Lending team)",
    prd_text:
      "The Consumer Lending group is building a digital personal loan product. Applicants apply online; we verify their identity and income, pull their credit report, and score credit risk to decide. Approved applicants get a personalized rate and an amortization schedule, e-sign the agreement, and receive funds disbursed to their account. Target: 30,000 applications per month.",
  },
];

function deriveTitle(prd: string): string {
  const first = prd.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (!first) return "Untitled analysis";
  const words = first.split(/\s+/);
  return words.length > 6 ? `${words.slice(0, 6).join(" ")}…` : words.slice(0, 6).join(" ");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_* env vars.");
  const supabase = createClient(url, key);

  for (const twin of DEMO_TWINS) {
    const { data: existing } = await supabase
      .from("analyses")
      .select("id")
      .eq("prd_text", twin.prd_text)
      .limit(1);
    if (existing && existing.length > 0) {
      console.log(`✓ ${twin.label} — already present, skipping`);
      continue;
    }

    console.log(`… ${twin.label} — analyzing`);
    const outcome = await analyze(twin.prd_text);
    if (!outcome.ok) {
      console.error(`✗ ${twin.label} — analysis failed: ${outcome.error}`);
      continue;
    }
    const result: AnalysisResult = outcome.result;
    const counts = { covered: 0, partial: 0, risky: 0, missing: 0 };
    for (const c of result.capabilities) counts[c.status] += 1;
    const savings_estimate = result.capabilities.reduce(
      (s, c) => s + (c.modification_plan?.est_savings_usd ?? 0),
      0,
    );

    const { error } = await supabase.from("analyses").insert({
      prd_text: twin.prd_text,
      prd_title: deriveTitle(twin.prd_text),
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
    if (error) console.error(`✗ ${twin.label} — insert failed: ${error.message}`);
    else console.log(`✓ ${twin.label} — seeded (${result.verdict}, ${result.capabilities.length} caps)`);
  }
  console.log("\nDone. Analyze a fraud or personal-loan PRD in the demo to see the twin-catcher fire.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
