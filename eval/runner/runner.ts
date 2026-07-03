/**
 * SpecBridge eval harness runner.
 *
 * Reads eval/dataset/prds.json, replays each PRD through runAnalysis() from
 * the analyze route (same pipeline as /demo — no HTTP), compares actual to
 * expected, and writes averaged metrics + per-metric spread to
 * eval/results/latest.json.
 *
 * The engine is non-deterministic, so a single run is a noisy sample. Use
 * multiple runs for a stable baseline:
 *
 *   npm run eval                # N=1, quick smoke check
 *   npm run eval -- --runs=5    # baseline-quality: 5 passes, mean + spread
 *
 * Each pass runs every PRD once; N passes give N independent samples of every
 * aggregate metric, reported as mean [min-max] with standard deviation.
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

// --- CLI ---
function parseRuns(argv: string[]): number {
  for (const a of argv) {
    const m = a.match(/^--runs=(\d+)$/);
    if (m) return Math.max(1, parseInt(m[1], 10));
  }
  const idx = argv.indexOf("--runs");
  if (idx >= 0 && argv[idx + 1] && /^\d+$/.test(argv[idx + 1])) {
    return Math.max(1, parseInt(argv[idx + 1], 10));
  }
  return 1;
}

// --- Stats ---
type Stat = {
  mean: number | null;
  min: number | null;
  max: number | null;
  stdev: number | null;
  n: number;
  samples: number[];
};
const round = (x: number) => Number(x.toFixed(4));
/** Summarize a list of samples (nulls/NaN dropped) into mean/min/max/stdev. */
function statBlock(values: (number | null)[]): Stat {
  const xs = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (xs.length === 0) {
    return { mean: null, min: null, max: null, stdev: null, n: 0, samples: [] };
  }
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const stdev = Math.sqrt(
    xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length,
  );
  return {
    mean: round(mean),
    min: round(Math.min(...xs)),
    max: round(Math.max(...xs)),
    stdev: round(stdev),
    n: xs.length,
    samples: xs.map(round),
  };
}

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

// --- Per-run result ---
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

/** Run one PRD through the engine once and score it. Silent (no logging). */
async function evaluateOne(prd: Prd): Promise<PrdResult> {
  const outcome = await runAnalysis(prd.prd_text);
  if (!outcome.ok) {
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

// --- Aggregate one pass (all PRDs, one round) into ratio metrics ---
type PassAggregate = {
  match_precision: number | null;
  match_recall: number | null;
  compliance_gate_accuracy: number | null;
  verdict_accuracy: number | null;
  score_in_range_accuracy: number | null;
  avg_input_tokens: number;
  avg_output_tokens: number;
  avg_cost_per_prd_usd: number;
  total_cost_usd: number;
  prds_ok: number;
  prds_failed: number;
};
function computePassAggregate(results: PrdResult[]): PassAggregate {
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
  return {
    match_precision: toolPicks === 0 ? null : toolCorrect / toolPicks,
    match_recall: expectedTools === 0 ? null : toolCorrect / expectedTools,
    compliance_gate_accuracy: statusTotal === 0 ? null : statusMatches / statusTotal,
    verdict_accuracy: ok.length ? verdictMatches / ok.length : null,
    score_in_range_accuracy: ok.length ? scoreInRange / ok.length : null,
    avg_input_tokens: Math.round(avgIn),
    avg_output_tokens: Math.round(avgOut),
    avg_cost_per_prd_usd: Number((ok.length ? totalCost / ok.length : 0).toFixed(4)),
    total_cost_usd: Number(totalCost.toFixed(4)),
    prds_ok: ok.length,
    prds_failed: results.length - ok.length,
  };
}

// --- Console formatting ---
const s3 = (s: Stat) =>
  s.mean === null
    ? "  n/a"
    : `${s.mean.toFixed(3)}  [${s.min!.toFixed(3)}-${s.max!.toFixed(3)}]  σ ${s.stdev!.toFixed(3)}`;
const short = (s: Stat, d = 2) =>
  s.mean === null
    ? "n/a"
    : `${s.mean.toFixed(d)} [${s.min!.toFixed(d)}-${s.max!.toFixed(d)}]`;

// --- Main ---
async function main() {
  const runs = parseRuns(process.argv.slice(2));
  console.log(`Reading dataset: ${DATASET_PATH}`);
  const dataset: Dataset = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  console.log(
    `Loaded ${dataset.prds.length} PRDs (dataset v${dataset.version}, target ${dataset.target_prd_count}). Runs per PRD: ${runs}.`,
  );

  const passAggregates: PassAggregate[] = [];
  const perPrdRuns = new Map<string, PrdResult[]>();
  const sampleDetail = new Map<string, PrdResult>();
  for (const prd of dataset.prds) perPrdRuns.set(prd.id, []);

  for (let pass = 1; pass <= runs; pass++) {
    const passResults: PrdResult[] = [];
    const marks: string[] = [];
    for (const prd of dataset.prds) {
      let r: PrdResult;
      try {
        r = await evaluateOne(prd);
      } catch (e) {
        r = {
          id: prd.id,
          title: prd.title,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          expected_verdict: prd.expected_verdict,
          expected_score_range: prd.expected_score_range,
          expected_count: prd.expected_matches.length,
        };
      }
      passResults.push(r);
      perPrdRuns.get(prd.id)!.push(r);
      if (pass === 1) sampleDetail.set(prd.id, r); // keep pass-1 detail as a sample
      marks.push(`${prd.id} ${r.ok ? "✓" : "✗"}`);
    }
    passAggregates.push(computePassAggregate(passResults));
    console.log(`[pass ${pass}/${runs}] ${marks.join("  ")}`);
  }

  // Aggregate metrics: one value per pass, summarized across passes.
  const metrics = {
    match_precision: statBlock(passAggregates.map((p) => p.match_precision)),
    match_recall: statBlock(passAggregates.map((p) => p.match_recall)),
    compliance_gate_accuracy: statBlock(
      passAggregates.map((p) => p.compliance_gate_accuracy),
    ),
    verdict_accuracy: statBlock(passAggregates.map((p) => p.verdict_accuracy)),
    score_in_range_accuracy: statBlock(
      passAggregates.map((p) => p.score_in_range_accuracy),
    ),
    avg_input_tokens: statBlock(passAggregates.map((p) => p.avg_input_tokens)),
    avg_output_tokens: statBlock(passAggregates.map((p) => p.avg_output_tokens)),
    avg_cost_per_prd_usd: statBlock(
      passAggregates.map((p) => p.avg_cost_per_prd_usd),
    ),
    total_run_cost_usd: Number(
      passAggregates.reduce((s, p) => s + p.total_cost_usd, 0).toFixed(4),
    ),
  };

  // Per-PRD summaries across the N runs.
  const perPrd = dataset.prds.map((prd) => {
    const rs = perPrdRuns.get(prd.id)!;
    const okRuns = rs.filter((r): r is PrdResultOk => r.ok);
    const verdictHits = okRuns.filter((r) => r.verdict_match).length;
    const rangeHits = okRuns.filter((r) => r.score_in_range).length;
    return {
      id: prd.id,
      title: prd.title,
      runs: rs.length,
      ok_count: okRuns.length,
      expected_score_range: prd.expected_score_range,
      tool_precision: statBlock(okRuns.map((r) => r.tool_precision)),
      tool_recall: statBlock(okRuns.map((r) => r.tool_recall)),
      status_accuracy: statBlock(okRuns.map((r) => r.status_accuracy)),
      score: statBlock(okRuns.map((r) => r.actual_score)),
      verdict_match_rate: okRuns.length ? round(verdictHits / okRuns.length) : null,
      score_in_range_rate: okRuns.length ? round(rangeHits / okRuns.length) : null,
      sample_detail: sampleDetail.get(prd.id),
    };
  });

  // Console: per-PRD summary
  console.log(`\nPer-PRD (mean [min-max] over ${runs} run${runs > 1 ? "s" : ""}):`);
  for (const p of perPrd) {
    const v =
      p.verdict_match_rate === null
        ? "n/a"
        : `${Math.round(p.verdict_match_rate * p.ok_count)}/${p.ok_count}`;
    console.log(
      `  ${p.id}  ok ${p.ok_count}/${p.runs}  prec ${short(p.tool_precision)}  gate ${short(p.status_accuracy)}  verdict ${v}  score ${short(p.score, 1)}`,
    );
  }

  // Console: aggregate with spread
  console.log("\n" + "═".repeat(64));
  console.log(`         AGGREGATE  (mean [min-max] σ over ${runs} pass${runs > 1 ? "es" : ""})`);
  console.log("═".repeat(64));
  console.log(`match_precision:          ${s3(metrics.match_precision)}`);
  console.log(`match_recall:             ${s3(metrics.match_recall)}`);
  console.log(`compliance_gate_accuracy: ${s3(metrics.compliance_gate_accuracy)}`);
  console.log(`verdict_accuracy:         ${s3(metrics.verdict_accuracy)}`);
  console.log(`score_in_range_accuracy:  ${s3(metrics.score_in_range_accuracy)}`);
  console.log(`avg_cost_per_prd_usd:     ${s3(metrics.avg_cost_per_prd_usd)}`);
  console.log(`total_run_cost:           $${metrics.total_run_cost_usd.toFixed(4)} (${runs} pass${runs > 1 ? "es" : ""})`);

  await mkdir(RESULTS_DIR, { recursive: true });
  const payload = {
    timestamp: new Date().toISOString(),
    dataset_version: dataset.version,
    dataset_prd_count: dataset.prds.length,
    runs,
    metrics,
    pass_aggregates: passAggregates,
    per_prd: perPrd,
  };
  await writeFile(RESULTS_PATH, JSON.stringify(payload, null, 2));
  console.log(`\nWrote results to ${RESULTS_PATH}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
