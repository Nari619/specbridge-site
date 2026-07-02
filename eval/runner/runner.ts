/**
 * SpecBridge eval harness runner.
 *
 * Reads eval/dataset/prds.json, replays each PRD through runAnalysis() from
 * the analyze route (same pipeline as /demo — no HTTP), compares actual to
 * expected, and writes per-PRD + aggregate metrics to eval/results/latest.json.
 *
 * Run: `npm run eval`
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAnalysis, type AnalysisResult } from "../../app/api/analyze/route";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const DATASET_PATH = resolve(PROJECT_ROOT, "eval/dataset/prds.json");
const RESULTS_DIR = resolve(PROJECT_ROOT, "eval/results");
const RESULTS_PATH = resolve(RESULTS_DIR, "latest.json");

// Claude Sonnet 4.6 pricing per 1M tokens.
const INPUT_PRICE_PER_M = 3.0;
const OUTPUT_PRICE_PER_M = 15.0;

// --- Dataset types ---
type ExpectedMatch = {
  capability: string;
  expected_status: "covered" | "partial" | "risky" | "missing";
  expected_tool: string | null;
  notes: string;
};
type Prd = {
  id: string;
  title: string;
  domain: string;
  prd_text: string;
  expected_matches: ExpectedMatch[];
  expected_verdict: "GO" | "NO-GO";
  expected_score_range: [number, number];
};
type Dataset = {
  version: number;
  target_prd_count: number;
  notes?: string;
  prds: Prd[];
};

// --- Fuzzy capability pairing ---
const STOP = new Set([
  "a","an","the","of","for","and","or","to","in","on","by","with","from","as","is","are","be",
  "this","that","these","those","it","its","at",
]);
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

type ActualCap = AnalysisResult["capabilities"][number];
type Pair = { actual: ActualCap; expected: ExpectedMatch; score: number };

function pairCapabilities(actual: ActualCap[], expected: ExpectedMatch[]) {
  const at = actual.map((a) => tokenize(a.requirement));
  const et = expected.map((e) => tokenize(e.capability));
  const cands: { i: number; j: number; score: number }[] = [];
  for (let i = 0; i < actual.length; i++) {
    for (let j = 0; j < expected.length; j++) {
      let s = jaccard(at[i], et[j]);
      // Exact tool match is a strong pairing hint
      if (
        actual[i].matched_tool !== null &&
        actual[i].matched_tool === expected[j].expected_tool
      ) {
        s += 0.5;
      }
      // Both agree it's missing (no tool) — small pairing hint
      if (
        actual[i].status === "missing" &&
        expected[j].expected_status === "missing"
      ) {
        s += 0.05;
      }
      cands.push({ i, j, score: s });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const usedI = new Set<number>();
  const usedJ = new Set<number>();
  const paired: Pair[] = [];
  const THRESHOLD = 0.15;
  for (const c of cands) {
    if (c.score < THRESHOLD) break;
    if (usedI.has(c.i) || usedJ.has(c.j)) continue;
    usedI.add(c.i);
    usedJ.add(c.j);
    paired.push({ actual: actual[c.i], expected: expected[c.j], score: c.score });
  }
  return {
    paired,
    unmatchedActual: actual.filter((_, i) => !usedI.has(i)),
    unmatchedExpected: expected.filter((_, j) => !usedJ.has(j)),
  };
}

// --- Per-PRD run ---
type PrdResultOk = {
  id: string;
  title: string;
  ok: true;
  actual_verdict: string;
  expected_verdict: string;
  verdict_match: boolean;
  actual_score: number;
  expected_score_range: [number, number];
  score_in_range: boolean;
  paired_count: number;
  expected_count: number;
  actual_capability_count: number;
  tool_pick_correct: number;
  tool_pick_total: number;
  expected_tool_total: number;
  tool_precision: number | null;
  tool_recall: number | null;
  status_matches: number;
  status_total: number;
  status_accuracy: number;
  usage: { input_tokens: number; output_tokens: number };
  cost_usd: number;
  pair_details: {
    expected_capability: string;
    actual_requirement: string;
    expected_tool: string | null;
    actual_tool: string | null;
    tool_match: boolean;
    expected_status: string;
    actual_status: string;
    status_match: boolean;
    similarity: number;
  }[];
  unmatched_expected: {
    capability: string;
    expected_status: string;
    expected_tool: string | null;
  }[];
  unmatched_actual: {
    requirement: string;
    status: string;
    matched_tool: string | null;
  }[];
};
type PrdResultErr = {
  id: string;
  title: string;
  ok: false;
  error: string;
  expected_verdict: string;
  expected_score_range: [number, number];
  expected_count: number;
};
type PrdResult = PrdResultOk | PrdResultErr;

async function runOne(prd: Prd, i: number, n: number): Promise<PrdResult> {
  console.log(`\n[${i + 1}/${n}] ${prd.id}: ${prd.title}`);
  const outcome = await runAnalysis(prd.prd_text);
  if (!outcome.ok) {
    console.log(`  ✗ analysis failed: ${outcome.error}`);
    return {
      id: prd.id,
      title: prd.title,
      ok: false,
      error: outcome.error,
      expected_verdict: prd.expected_verdict,
      expected_score_range: prd.expected_score_range,
      expected_count: prd.expected_matches.length,
    };
  }
  const { result, usage } = outcome;
  const cost =
    (usage.input_tokens * INPUT_PRICE_PER_M +
      usage.output_tokens * OUTPUT_PRICE_PER_M) /
    1_000_000;
  const verdictMatch = result.verdict === prd.expected_verdict;
  const inRange =
    result.readiness_score >= prd.expected_score_range[0] &&
    result.readiness_score <= prd.expected_score_range[1];

  const { paired, unmatchedActual, unmatchedExpected } = pairCapabilities(
    result.capabilities,
    prd.expected_matches,
  );

  const actualToolPicks = result.capabilities.filter(
    (c) => c.matched_tool !== null,
  ).length;
  const expectedWithTool = prd.expected_matches.filter(
    (e) => e.expected_tool !== null,
  ).length;

  let correctToolPicks = 0;
  let statusMatches = 0;
  const pair_details = paired.map((p) => {
    const toolMatch =
      p.actual.matched_tool !== null &&
      p.actual.matched_tool === p.expected.expected_tool;
    const statusMatch = p.actual.status === p.expected.expected_status;
    if (toolMatch) correctToolPicks++;
    if (statusMatch) statusMatches++;
    return {
      expected_capability: p.expected.capability,
      actual_requirement: p.actual.requirement,
      expected_tool: p.expected.expected_tool,
      actual_tool: p.actual.matched_tool,
      tool_match: toolMatch,
      expected_status: p.expected.expected_status,
      actual_status: p.actual.status,
      status_match: statusMatch,
      similarity: Number(p.score.toFixed(3)),
    };
  });

  const precision = actualToolPicks === 0 ? null : correctToolPicks / actualToolPicks;
  const recall = expectedWithTool === 0 ? null : correctToolPicks / expectedWithTool;
  const gate = statusMatches / prd.expected_matches.length;

  console.log(
    `  ✓ ${result.capabilities.length} caps · score ${result.readiness_score} · verdict ${result.verdict} · in ${usage.input_tokens}t out ${usage.output_tokens}t · $${cost.toFixed(4)}`,
  );
  console.log(
    `     precision ${precision === null ? "n/a" : precision.toFixed(2)} · recall ${recall === null ? "n/a" : recall.toFixed(2)} · gate ${gate.toFixed(2)} · verdict ${verdictMatch ? "✓" : "✗"} · in-range ${inRange ? "✓" : "✗"}`,
  );

  return {
    id: prd.id,
    title: prd.title,
    ok: true,
    actual_verdict: result.verdict,
    expected_verdict: prd.expected_verdict,
    verdict_match: verdictMatch,
    actual_score: result.readiness_score,
    expected_score_range: prd.expected_score_range,
    score_in_range: inRange,
    paired_count: paired.length,
    expected_count: prd.expected_matches.length,
    actual_capability_count: result.capabilities.length,
    tool_pick_correct: correctToolPicks,
    tool_pick_total: actualToolPicks,
    expected_tool_total: expectedWithTool,
    tool_precision: precision,
    tool_recall: recall,
    status_matches: statusMatches,
    status_total: prd.expected_matches.length,
    status_accuracy: gate,
    usage,
    cost_usd: cost,
    pair_details,
    unmatched_expected: unmatchedExpected.map((e) => ({
      capability: e.capability,
      expected_status: e.expected_status,
      expected_tool: e.expected_tool,
    })),
    unmatched_actual: unmatchedActual.map((a) => ({
      requirement: a.requirement,
      status: a.status,
      matched_tool: a.matched_tool,
    })),
  };
}

// --- Main ---
async function main() {
  console.log(`Reading dataset: ${DATASET_PATH}`);
  const dataset: Dataset = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  console.log(
    `Loaded ${dataset.prds.length} PRDs (dataset v${dataset.version}, target ${dataset.target_prd_count})`,
  );

  const results: PrdResult[] = [];
  for (let i = 0; i < dataset.prds.length; i++) {
    try {
      results.push(await runOne(dataset.prds[i], i, dataset.prds.length));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ✗ crashed on ${dataset.prds[i].id}: ${msg}`);
      results.push({
        id: dataset.prds[i].id,
        title: dataset.prds[i].title,
        ok: false,
        error: msg,
        expected_verdict: dataset.prds[i].expected_verdict,
        expected_score_range: dataset.prds[i].expected_score_range,
        expected_count: dataset.prds[i].expected_matches.length,
      });
    }
  }

  const ok = results.filter((r): r is PrdResultOk => r.ok);
  const toolCorrect = ok.reduce((s, r) => s + r.tool_pick_correct, 0);
  const toolPicks = ok.reduce((s, r) => s + r.tool_pick_total, 0);
  const expectedTools = ok.reduce((s, r) => s + r.expected_tool_total, 0);
  const statusMatches = ok.reduce((s, r) => s + r.status_matches, 0);
  const statusTotal = results.reduce((s, r) => s + r.expected_count, 0);
  const verdictMatches = ok.filter((r) => r.verdict_match).length;
  const scoreInRange = ok.filter((r) => r.score_in_range).length;
  const avgIn = ok.length ? ok.reduce((s, r) => s + r.usage.input_tokens, 0) / ok.length : 0;
  const avgOut = ok.length ? ok.reduce((s, r) => s + r.usage.output_tokens, 0) / ok.length : 0;
  const totalCost = ok.reduce((s, r) => s + r.cost_usd, 0);

  const metrics = {
    match_precision: toolPicks === 0 ? null : toolCorrect / toolPicks,
    match_recall: expectedTools === 0 ? null : toolCorrect / expectedTools,
    compliance_gate_accuracy: statusTotal === 0 ? null : statusMatches / statusTotal,
    verdict_accuracy: ok.length ? verdictMatches / ok.length : null,
    score_in_range_accuracy: ok.length ? scoreInRange / ok.length : null,
    avg_input_tokens: Math.round(avgIn),
    avg_output_tokens: Math.round(avgOut),
    avg_total_tokens: Math.round(avgIn + avgOut),
    avg_cost_per_prd_usd: ok.length ? Number((totalCost / ok.length).toFixed(4)) : 0,
    total_run_cost_usd: Number(totalCost.toFixed(4)),
    prds_attempted: results.length,
    prds_ok: ok.length,
    prds_failed: results.length - ok.length,
  };

  const fmt = (v: number | null, d = 3) => (v === null ? "  n/a" : v.toFixed(d));
  console.log("\n" + "═".repeat(58));
  console.log("                     AGGREGATE");
  console.log("═".repeat(58));
  console.log(
    `match_precision:          ${fmt(metrics.match_precision)}  (${toolCorrect}/${toolPicks} correct tool picks)`,
  );
  console.log(
    `match_recall:             ${fmt(metrics.match_recall)}  (${toolCorrect}/${expectedTools} expected tools found)`,
  );
  console.log(
    `compliance_gate_accuracy: ${fmt(metrics.compliance_gate_accuracy)}  (${statusMatches}/${statusTotal} status matches)`,
  );
  console.log(
    `verdict_accuracy:         ${fmt(metrics.verdict_accuracy)}  (${verdictMatches}/${ok.length})`,
  );
  console.log(
    `score_in_range_accuracy:  ${fmt(metrics.score_in_range_accuracy)}  (${scoreInRange}/${ok.length})`,
  );
  console.log(`avg_input_tokens:         ${metrics.avg_input_tokens}`);
  console.log(`avg_output_tokens:        ${metrics.avg_output_tokens}`);
  console.log(`avg_cost_per_prd:         $${metrics.avg_cost_per_prd_usd.toFixed(4)}`);
  console.log(`total_run_cost:           $${metrics.total_run_cost_usd.toFixed(4)}`);
  console.log(
    `prds ok:                  ${metrics.prds_ok}/${metrics.prds_attempted} (failed: ${metrics.prds_failed})`,
  );

  await mkdir(RESULTS_DIR, { recursive: true });
  const payload = {
    timestamp: new Date().toISOString(),
    dataset_version: dataset.version,
    dataset_prd_count: dataset.prds.length,
    metrics,
    per_prd: results,
  };
  await writeFile(RESULTS_PATH, JSON.stringify(payload, null, 2));
  console.log(`\nWrote results to ${RESULTS_PATH}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
