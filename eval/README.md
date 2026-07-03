# SpecBridge Eval Harness

An offline accuracy harness for the SpecBridge analysis engine. It replays a
hand-labeled set of PRDs through the live analyze pipeline (the 100-tool
Supabase registry, the LLM matcher, the deterministic PII backstop, and the
compliance gate) and compares the engine's output to what a human labeler
expected.

**Status:** runner in place. Runs locally with `npm run eval`. Full baseline
below.

---

## Latest baseline (dataset v2, `--runs=5`)

The authoritative baseline is a **5-pass distribution** (15 analyze calls),
after the first label-review pass tightened the ground truth. **These are the
numbers every future upgrade is measured against** — compare a change's 5-run
distribution to this one. Full detail in [`results/latest.json`](results/latest.json).

| Metric | mean | spread [min–max] | σ |
|---|---|---|---|
| **match_precision** | **63.3%** | 59.1–66.7% | 0.024 |
| **match_recall** | **92.0%** | 86.7–93.3% | 0.027 |
| **compliance_gate_accuracy** | **88.9%** | 83.3–94.4% | 0.035 |
| **verdict_accuracy** | **100%** | 100–100% | 0.000 |
| **score_in_range_accuracy** | **100%** | 100–100% | 0.000 |
| **avg cost per PRD** | $0.107 | $0.102–0.111 | — |
| **total run cost** | $1.61 | (15 calls) | — |

> **Why this replaced the single-run snapshot.** The v2 commit reported a single
> run with `compliance_gate_accuracy` 72.2% and `match_precision` 59.1%. The
> 5-run distribution shows those were **low samples** — the true means are
> **88.9%** and **63.3%**, with the single run sitting at or below the observed
> minimum. This is exactly why single runs must not be used to judge a change:
> one sample was ~16 points low on gate accuracy purely from LLM variance.
> `verdict_accuracy` and `score_in_range_accuracy`, by contrast, are rock-solid
> at 100% (σ 0.000) — those are stable signals; the matching metrics are the
> variable ones.

### How to interpret these numbers

**Most remaining disagreements are engine run-to-run variance, not label
error.** The engine is non-deterministic: across runs the same capability
legitimately flips (e.g. `statement_generator` covered↔partial,
`transaction_categorizer` covered↔partial, the notification's risky flag depends
on whether the LLM tags it PII that run, and the rewards calc sometimes matches
`budgeting_insights_engine` instead of `rewards_points_engine`). The v2 labels
encode the *defensible* ground truth; any single run disagrees on a few
capabilities purely from LLM variance. That is why the baseline is a
distribution — see "Measuring a baseline" for the standard.

`compliance_gate_accuracy` (88.9% mean) now matches the gate's design closely;
its remaining spread (σ 0.035) is mostly the LLM's variable `required_clearances`
assignment (whether it flags a given capability as PII-touching on a given run),
an engine-determinism question, not a labeling one. `match_precision` (63.3%) is
the metric most worth improving — dragged down by prd_003, where the engine's
crypto tool picks are the least stable.

On score ranges: **prd_003's band is `[50, 75]`** to contain its genuine
run-to-run instability (55–70 observed) — peripheral `covered` capabilities
swing the unweighted average, the exact symptom of the criticality-weighting
limitation logged in the Engine limitations backlog. A range must contain
reality, not one lucky run; widen it when a metric flaps for variance reasons,
not to paper over a real regression.

---

## Known issues surfaced by baseline

1. **[RESOLVED 2026-07-02] Complex PRDs (7+ capabilities) risk JSON truncation
   at `max_tokens=4000`.** `prd_003` (crypto custody + trading) failed with
   "unexpected format" — the model's structured JSON response was cut off
   mid-object. Fixed by raising `max_tokens` to 8000 (comfortable headroom for
   the ~6,750-token 15-capability worst case; Anthropic bills actual output
   tokens, so it's free for normal calls), plus explicit `stop_reason ===
   "max_tokens"` truncation detection returning a specific error, and
   head/tail logging of the raw response on any parse failure. prd_003 now
   completes at 3,500 output tokens (14 capabilities, ~56% headroom under the
   new ceiling). Considered `jsonrepair` and rejected it: it can only fix
   syntax, but a truncation loses real content, and silent partial success is
   worse than clear failure.
2. **[RESOLVED 2026-07-02, dataset v2] Labels need tightening.** The engine's
   PII backstop is stricter than several initial labels (`rewards_points_engine`
   came back `risky` where labeled `partial`). Fixed in the first label-review
   pass: corrected `rewards_points_engine` and the rewards-breakdown tool to
   `risky` (empty `compliance_tags` + PII), corrected prd_003's ledger posting
   to `covered` (no unstated domain assumptions), added under-decomposed
   capabilities, and codified the rules in the "Labeling standard" section.
3. **[PARTIALLY RESOLVED 2026-07-02] Engine over-decomposes PRDs vs labels.**
   Two sub-cases were untangled in the label review: (a) prd_001's
   document-center capability was a *label* problem — the PRD was ambiguous, so
   its text was sharpened to explicitly scope generation only and hand
   presentment/delivery to an existing system (keeps it a clean GO); (b) the
   engine genuinely surfacing more granular capabilities than labels is
   legitimate and is now handled by decomposing labels to match. Residual
   thoroughness-vs-precision tension remains as more PRDs are added.

---

## Engine limitations backlog

Distinct from label issues — these are genuine engine shortcomings the eval
surfaced, tracked here until addressed (not fixable by relabeling).

1. **Readiness score has no capability-criticality weighting.** The score
   averages all capabilities equally, so a product that is fundamentally
   non-viable can still score in the middle. prd_003 (crypto custody + trading)
   scored ~70 despite having **no custody engine and no trading engine** — the
   two existential `missing` capabilities were diluted to ~14% of a 14-capability
   decomposition by many peripheral `covered` capabilities (KYC, AML, sanctions,
   consent, monitoring…). A missing "custody" for a custody product is not
   equal to a missing nice-to-have. Fix direction: weight or flag existential
   `missing` capabilities so they dominate the score (or cap the score when a
   critical-path capability is missing). Surfaced by the prd_003 score
   disagreement during the v2 label review.

---

## Running it

```bash
npm run eval                 # N=1, quick smoke check
npm run eval -- --runs=5     # baseline-quality: 5 passes, mean + spread
```

Reads `dataset/prds.json`, replays each PRD through the internal
`runAnalysis()` function (the same pipeline `/demo` uses — no HTTP round-trip,
no live-URL burn), and writes results to `results/latest.json`.

Requires `.env.local` with `ANTHROPIC_API_KEY` and the
`NEXT_PUBLIC_SUPABASE_*` vars set (already needed for `/demo`).

---

## Measuring a baseline (the standard for before/after comparisons)

The engine is non-deterministic, so **a single run (`N=1`) is a noisy sample and
must not be used to judge an engine change.** Across runs the same capability
legitimately flips status, the LLM picks different tools, and scores swing by
10+ points. One run can move a metric several points for no reason at all.

**The standard: for any before/after comparison of an engine change, run
`npm run eval -- --runs=5` on both sides and compare distributions, not single
numbers.**

- Each **pass** runs every PRD once; `N` passes give `N` independent samples of
  every aggregate metric. The runner reports each metric as **mean, [min–max],
  and σ (standard deviation)** across the passes.
- **A change is only real signal if the means separate by more than the
  spread.** If before is `0.58 ± 0.05` and after is `0.61 ± 0.06`, that overlap
  is noise, not improvement — you need more runs or a bigger effect.
- Record the mean and spread in the PR that makes the change. Use `--runs=5`
  minimum for anything you'll cite; `--runs=1` is for smoke checks only.
- Cost scales linearly: `N × (# PRDs)` analyze calls (~$0.10 each). `--runs=5`
  on the 3 seeded PRDs is 15 calls, ~$1.60, ~5 min.

Aggregation detail: each metric is computed per pass (ratio of that pass's
sums), then the per-pass values are summarized. This is **mean-of-ratios**
(the expected metric value on a typical run and its variability), which is what
you want for variance — not ratio-of-pooled-sums.

`results/latest.json` records `runs`, the summarized `metrics` (with `samples`
arrays), every pass's raw aggregate in `pass_aggregates`, and per-PRD stat
blocks. Full capability-level `pair_details` are stored for **pass 1 only** as a
representative debugging sample (storing all N would bloat the file with
redundant dumps).

---

## What the harness measures

For each PRD in the dataset, the harness:

1. Calls `runAnalysis(prd_text)` directly (imported from
   `app/api/analyze/route.ts` — same code path as the browser demo, skips the
   Supabase save so evals don't pollute the memory dashboard).
2. Matches each returned `capability` back to the labeled `expected_matches`
   entry (by Jaccard overlap on tokenized text, with a boost for exact tool
   matches).
3. Compares the returned `matched_tool` and `status` to the expected values.
4. Compares the top-level `verdict` and `readiness_score` to the expected
   verdict and score range.
5. Records the analyze call's input/output token counts and the resulting
   USD cost.

The point is not to grade the LLM in isolation — it's to catch regressions in
the whole system (registry data, prompt, deterministic gate, PII backstop, and
scoring) as any of them evolve.

---

## The 4 metrics

Every run produces four aggregate numbers over the dataset.

1. **Match precision** — of the tools SpecBridge picked, how many were the
   expected tool.
   `correct_tool_picks / total_tool_picks`
   Denominator excludes labeled `missing` capabilities (where `expected_tool`
   is `null`). Measures: when SpecBridge does pick a tool, is it the right one?

2. **Match recall** — of the labeled capabilities in the dataset, how many did
   SpecBridge identify at all.
   `capabilities_correctly_identified / total_expected_capabilities`
   A capability is "identified" if the engine returned a capability whose text
   matches this labeled one (regardless of tool choice). Measures: does the
   engine surface every requirement a labeler saw?

3. **Compliance-gate accuracy** — for each labeled capability, does the engine
   produce the right `status` on the risky-vs-non-risky axis.
   `(true_risky + true_non_risky) / total_labeled`
   This is the target metric for the deterministic gate and the PII backstop.
   A regression here (e.g. gate stops firing on a missing `pii-cleared` tag)
   shows up immediately.

4. **End-to-end token cost per analysis** — average input tokens, output
   tokens, and USD cost per PRD run. Reported as a running average with a
   per-run breakdown so a prompt change that inflates cost is visible.

Verdict agreement and score-range hits are recorded as separate diagnostics
per PRD but not aggregated as one of the four headline metrics — they roll up
implicitly through match+gate accuracy.

---

## Dataset format

Everything lives in `dataset/prds.json`. Shape:

```json
{
  "version": 1,
  "target_prd_count": 50,
  "notes": "...",
  "prds": [
    {
      "id": "prd_001",
      "title": "short human-readable title",
      "domain": "e.g. lending, payments, wealth",
      "prd_text": "the actual PRD content",
      "expected_matches": [
        {
          "capability": "one requirement from the PRD",
          "expected_status": "covered | partial | risky | missing",
          "expected_tool": "registry tool name or null if missing",
          "notes": "why this is the expected answer"
        }
      ],
      "expected_verdict": "GO | NO-GO",
      "expected_score_range": [low, high]
    }
  ]
}
```

- **`id`** — stable identifier; use `prd_NNN` zero-padded to 3 digits.
- **`title`** — short label used in reports and diffs.
- **`domain`** — used to slice metrics by product area (e.g. "how well does
  the engine handle lending PRDs vs wealth PRDs").
- **`prd_text`** — the exact string sent to `/api/analyze`. Write it like a
  real PRD; the engine's matcher is prompt-quality-sensitive.
- **`expected_matches[]`** — every capability a labeler expects the engine to
  find. Order doesn't matter; the runner matches by capability-text overlap.
  - `expected_status` — the FINAL status the engine should produce, AFTER the
    deterministic gate runs. So if a capability touches PII and its natural
    matched tool lacks `pii-cleared`, the expected status is `risky`, not
    whatever the LLM would have said pre-gate.
  - `expected_tool` — must be an exact tool `name` from the Supabase registry,
    or `null` for `missing` capabilities.
  - `notes` — why this is the expected answer. Read the notes on the 3 seeded
    PRDs for the level of detail we want.
- **`expected_verdict`** — `GO` or `NO-GO`.
- **`expected_score_range`** — inclusive `[low, high]`. Set a wide-enough band
  that natural LLM variance doesn't flap; the gate flip is what matters, not
  ±3 points.

---

## Labeling standard

This is the authoritative standard every PRD label must follow. It was locked
after the first label-review pass (dataset v2). When you label, ground every
decision in **the PRD text and the registry `compliance_tags` only** — do not
inject outside domain knowledge the engine cannot see.

### Status definitions

- **`covered`** — an active tool matches functionally AND carries every
  clearance the capability needs (so the deterministic gate leaves it alone).
- **`partial`** — an active tool matches functionally but has a real gap the
  team must close. See the extend-vs-new rule below for where the partial/
  missing line falls.
- **`missing`** — no tool in the registry supports this capability. Set
  `expected_tool: null`.
- **`risky`** — the tool exists and functionally fits, but the deterministic
  gate flips it because a required clearance is absent from the tool's
  `compliance_tags`, or the tool is deprecated.

### The extend-vs-new rule (partial vs missing)

The single test for whether a gap is `partial` or `missing`:

> **If an existing registry tool already does ~70%+ of the job and the gap is
> configuration or extension of that tool, it's `partial`. If the gap needs
> fundamentally new functionality that no tool provides, it's `missing`.**

Worked example (prd_003): displaying real-time crypto prices → `partial` on
`market_data_feed`, because the tool already delivers real-time market data
(delivery plumbing + in-app display exist); adding crypto symbols is a new data
source, i.e. an extension. Contrast: crypto custody and crypto trading →
`missing`, because no tool provides wallet custody or crypto trade execution at
all — that's fundamentally new functionality, not an extension.

### Governance rules

- **Risky dominates.** If a capability has both a functional gap (`partial`)
  and a compliance gap (a required clearance absent from the matched tool's
  tags), the label is `risky`. Compliance risk overrides functional status —
  this mirrors the deterministic gate, which clears the modification plan and
  sets `risky`. (prd_002 lesson: `rewards_points_engine` has empty
  `compliance_tags`, so a PII-touching rewards calc is `risky`, not `partial`.)
- **Status is the FINAL, post-gate status.** Label what the engine should
  output after the PII backstop and compliance gate run, not the LLM's raw
  functional call.
- **Ground tool choice in the registry, not intuition.** `expected_tool` must
  be an exact tool `name`. Don't assert a plausible-sounding tool you haven't
  confirmed handles the capability (prd_002 lesson: a monthly rewards breakdown
  is the `rewards_points_engine`'s job, not the account `statement_generator`).
- **Don't inject unstated domain knowledge.** If the registry tool description
  and the PRD text support `covered`, label `covered` even if real-world
  experience says a modification would probably be needed (prd_003 lesson:
  `ledger_posting_service` posts journal entries generically → `covered` for
  crypto postings, despite a real bank likely needing a new chart-of-accounts
  class, because that need is nowhere in the tool description or PRD).
- **Respect explicit scope boundaries.** If the PRD explicitly carves work out
  as out-of-scope or owned by an existing system, do not label it as a
  capability (prd_001 lesson: statement presentment/delivery is a separate
  existing system; the PRD covers generation only).
- **Decompose to match the engine's granularity.** Label one capability per
  distinct system action. Under-decomposing (fewer labels than the engine
  produces) leaves correct engine capabilities unmatched and understates
  accuracy.
- **Set score ranges wide.** A 15-20 point band absorbs LLM variance; the gate
  flip and verdict are what matter, not ±3 points.

---

## Seeded PRDs

Three PRDs are seeded to exercise the main engine paths. Target is 50 total.

| id | Title | What it exercises |
|---|---|---|
| `prd_001` | Monthly Savings Statement Generator | Clean covered path: all 4 capabilities map to compliant tools; verifies the gate does not over-flag. Expected GO, ~85-100. |
| `prd_002` | Custom Card Rewards Categories | Real parameter-level modifications (partial), one clear missing capability, and one PII-backstop risky trap on `notification_dispatcher`'s empty tags. Expected NO-GO, mixed statuses. |
| `prd_003` | Retail Cryptocurrency Custody & Trading | Novel-capability territory: multiple `missing` items (crypto custody, crypto trading) with a few `partial` extensions to existing tools (`market_data_feed`, `ledger_posting_service`, `regulatory_report_builder`) and covered basics (KYC, AML). Expected NO-GO, ~40-60. |

---

## How to add more PRDs

1. **Read the live registry first.** Tool names in `expected_tool` must match
   Supabase rows exactly. Query the registry to see current names, tags, and
   deprecated flags before labeling. A quick way:

   ```bash
   node --input-type=module -e "
     import { readFileSync } from 'node:fs';
     import { createClient } from '@supabase/supabase-js';
     const env = Object.fromEntries(readFileSync('.env.local','utf8')
       .split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
       .map(l=>{const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
     const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
     const { data } = await s.from('tools').select('name, compliance_tags, status');
     for (const t of data) console.log(t.name, t.compliance_tags, t.status);
   "
   ```

2. **Write the PRD as a real one would read.** Include a volume estimate — it
   changes cost expectations and sometimes matching.

3. **Decompose it into capabilities.** One capability per system action.
   Don't collapse multiple actions into one entry; the harness scores per
   capability.

4. **Fill in `expected_status` using the labeling rules:**
   - `covered` — an active tool matches functionally AND the tool carries
     every clearance the capability needs.
   - `partial` — an active tool matches functionally but has a parameter- or
     feature-level gap the team must close.
   - `missing` — no tool in the registry supports this capability. Set
     `expected_tool: null`.
   - `risky` — the tool exists and functionally fits, but the deterministic
     gate should flip it because a needed clearance is absent from
     `compliance_tags`, OR the tool is deprecated.

5. **Label PII sensitivity honestly.** If a capability text mentions
   customer/account/PII terms (see `PII_SIGNALS` in `app/api/analyze/route.ts`
   for the exact list) and the natural tool lacks `pii-cleared`, the expected
   status is `risky` — the backstop will trip in code.

6. **Set a wide `expected_score_range`.** LLM output variance can move scores
   by a few points across runs. A 15-20 point band is usually right; tighten
   only for regressions you specifically want to catch.

7. **Increment `id`.** Use `prd_004`, `prd_005`, etc.

---

## What's NOT in scope yet

- CI wiring — the harness runs locally first; automated CI hookup is later.
- Cost-optimization heuristics — token cost is measured, not tuned.
- Parallel passes — `--runs=N` runs sequentially to stay simple and avoid rate
  limits; fine at the current scale (~5 min for 15 calls).
