/**
 * Calibrate PRD_SIMILARITY_THRESHOLD on real pairs. FREE, deterministic, no API.
 * Scores deliberately-similar, same-domain-different-intent, and clearly-
 * different PRD pairs so the threshold is set on evidence — the value that
 * cleanly separates "genuinely overlapping" from "same domain, different intent".
 *
 * Run: npx tsx eval/calibrate-similarity.ts
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrdComparer, type PrdRef } from "@/lib/prd-similarity";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Two deliberately-overlapping PRDs, framed as DIFFERENT teams than the dataset
// originals — the "two teams about to build the same thing" scenario, and the
// live-demo pair.
const FRAUD_B: PrdRef = {
  id: "fraudB (Risk-Ops team)",
  text: "The Risk Operations team is adding real-time fraud detection to our card platform. At each card authorization we score the transaction for fraud risk, fingerprint the device, and evaluate session risk signals, monitoring for suspicious patterns across accounts. When a transaction looks fraudulent we place a hold and alert the cardholder. Must decision within 200ms. Volume: ~10 million authorizations per day.",
};
const LENDING_B: PrdRef = {
  id: "lendingB (Consumer Lending team)",
  text: "The Consumer Lending group is building a digital personal loan product. Applicants apply online; we verify their identity and income, pull their credit report, and score credit risk to decide. Approved applicants get a personalized rate and an amortization schedule, e-sign the agreement, and receive funds disbursed to their account. Target: 30,000 applications per month.",
};

type Pair = { a: string; b: string; note: string };

const OVERLAPPING: Pair[] = [
  { a: "prd_007", b: "fraudB (Risk-Ops team)", note: "two fraud-detection teams (DEMO pair)" },
  { a: "prd_004", b: "lendingB (Consumer Lending team)", note: "two personal-loan teams" },
];
const SAME_DOMAIN_DIFF_INTENT: Pair[] = [
  { a: "prd_004", b: "prd_008", note: "lending: personal loan vs mortgage" },
  { a: "prd_003", b: "prd_006", note: "wealth: crypto vs robo-advisory" },
];
const DIFFERENT: Pair[] = [
  { a: "prd_007", b: "prd_001", note: "fraud vs statements" },
  { a: "prd_005", b: "prd_003", note: "wire transfer vs crypto" },
  { a: "prd_001", b: "prd_006", note: "statements vs robo-advisory" },
  { a: "prd_002", b: "prd_005", note: "card rewards vs wire transfer" },
];

async function main() {
  const ds = JSON.parse(
    await readFile(resolve(__dirname, "dataset/prds.json"), "utf8"),
  );
  const refs: PrdRef[] = ds.prds.map((p: { id: string; prd_text: string }) => ({
    id: p.id,
    text: p.prd_text,
  }));
  refs.push(FRAUD_B, LENDING_B);
  const byId = new Map(refs.map((r) => [r.id, r.text]));
  const comparer = createPrdComparer(refs);

  const score = (p: Pair) => comparer.similarity(byId.get(p.a)!, byId.get(p.b)!);
  const show = (title: string, pairs: Pair[]) => {
    console.log(`\n=== ${title} ===`);
    for (const p of pairs) {
      console.log(`  ${score(p).toFixed(4)}   ${p.a}  ×  ${p.b}   (${p.note})`);
    }
    return pairs.map(score);
  };

  const over = show("OVERLAPPING — expect HIGH", OVERLAPPING);
  const same = show("SAME DOMAIN, DIFFERENT INTENT — expect BELOW threshold", SAME_DOMAIN_DIFF_INTENT);
  const diff = show("DIFFERENT — expect LOW", DIFFERENT);

  const minOver = Math.min(...over);
  const maxNonOver = Math.max(...same, ...diff);
  const maxSame = Math.max(...same);
  console.log("\n=== SEPARATION ===");
  console.log(`  min OVERLAPPING score:              ${minOver.toFixed(4)}`);
  console.log(`  max SAME-DOMAIN-DIFF-INTENT score:  ${maxSame.toFixed(4)}`);
  console.log(`  max NON-OVERLAPPING score:          ${maxNonOver.toFixed(4)}`);
  console.log(`  gap (min-overlap − max-non-overlap): ${(minOver - maxNonOver).toFixed(4)}`);
  if (minOver > maxNonOver) {
    const mid = (minOver + maxNonOver) / 2;
    console.log(`  → clean separation. Suggested threshold (midpoint): ${mid.toFixed(3)}`);
  } else {
    console.log("  → NO clean separation at these features; inspect the overlap.");
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
