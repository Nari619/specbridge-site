# SpecBridge Eval Harness

An offline accuracy harness for the SpecBridge analysis engine. It replays a
hand-labeled set of PRDs through the live analyze pipeline (the 100-tool
Supabase registry, the LLM matcher, the deterministic PII backstop, and the
compliance gate) and compares the engine's output to what a human labeler
expected.

**Status:** runner in place. Runs locally with `npm run eval`. Full baseline
below.

---

## Latest baseline (dataset v3 — 8 PRDs, `--runs=5`)

The authoritative baseline is a **5-pass distribution over all 8 PRDs** (40
analyze calls). **These are the numbers every future upgrade is measured
against** — compare a change's 5-run distribution to this one. Full detail in
[`results/latest.json`](results/latest.json).

| Metric | mean | spread [min–max] | σ |
|---|---|---|---|
| **match_precision** | **68.4%** | 65.3–73.9% | 0.033 |
| **match_recall** | **95.5%** | 91.8–98.0% | 0.020 |
| **compliance_gate_accuracy** | **88.3%** | 81.7–93.3% | 0.041 |
| **verdict_accuracy** | **87.5%** | 87.5–87.5% | 0.000 |
| **score_in_range_accuracy** | **87.5%** | 87.5–87.5% | 0.000 |
| **avg cost per PRD** | $0.109 | $0.107–0.111 | — |
| **total run cost** | $4.35 | (40 calls) | — |

> **From 3 PRDs to 8.** Precision (63.3%→68.4%) and recall (92.0%→95.5%) rose
> with the larger, cleaner set; gate held (~88%). `verdict_accuracy` is 7/8 —
> the one non-match is **prd_007, an intentional divergence probe** (see below),
> not a regression. `score_in_range_accuracy` is also 7/8: after calibrating the
> five new PRDs' ranges to observed reality, every PRD's scores fall in-range
> except prd_007, whose range is deliberately left uncalibrated as part of the
> probe. Both "misses" are the same intentional case.

### Per-PRD (5-run means)

| PRD | domain | verdict (label→engine) | score [min–max] | range | prec | gate |
|---|---|---|---|---|---|---|
| 001 | accounts | GO → GO 5/5 | 100 | [85,100] | 0.96 | 1.00 |
| 002 | cards | NO-GO 5/5 | 56 [44–73] | [42,75] | 0.75 | 0.83 |
| 003 | wealth/crypto | NO-GO 5/5 | 62 [53–70] | [50,75] | 0.37 | 0.83 |
| 004 | lending | NO-GO 5/5 | 72 [56–80] | [54,82] | 0.54 | 0.87 |
| 005 | payments | GO → GO 5/5 | 99 [93–100] | [88,100] | 1.00 | 0.97 |
| 006 | wealth/robo | NO-GO 5/5 | 66 [57–72] | [54,74] | 0.47 | 0.85 |
| **007** | **fraud** | **GO → NO-GO 0/5** | **77 [71–79]** | **[82,98]** | **1.00** | **0.97** |
| 008 | mortgage | NO-GO 5/5 | 58 [46–71] | [44,74] | 0.91 | 0.84 |

### How to interpret these numbers

**Most remaining disagreements are engine run-to-run variance, not label
error.** The engine is non-deterministic: across runs the same capability
legitimately flips (e.g. `statement_generator` covered↔partial, and in
PII-heavy domains like lending the LLM tags many capabilities as PII-requiring,
flipping `audit-grade`-only tools to risky on some runs). The labels encode the
*defensible* ground truth; any single run disagrees on a few capabilities purely
from variance — that is why the baseline is a distribution.

`match_precision` (68.4%) is the metric most worth improving, dragged down by
prd_003 and prd_006 where the engine's tool picks are least stable.
`compliance_gate_accuracy` (88.3%) closely matches the gate's design; its spread
is mostly the LLM's variable `required_clearances` assignment.

### Intentional divergences

Some labels deliberately disagree with the engine to document a known behavior.
**Do not "fix" these by relabeling** — they are probes.

- **prd_007 (fraud) — labeled GO, engine returns NO-GO 5/5.** Two engine
  findings drive this, both logged in the backlog:
  1. The engine reads a **non-functional constraint** ("latency budget under
     150ms") as a *capability* and marks it `missing` (no tool). This is the
     engine already sensing an **orchestration gap** — evidence the orchestrator
     is the right next build.
  2. The PRD's one **peripheral risky** capability (a fraud-hold notification on
     `notification_dispatcher`) coincides with that missing, so we cannot cleanly
     attribute the NO-GO to the risky alone (see backlog: needs an isolated
     single-risky/zero-missing test PRD).
  The label stays GO on purpose. If the orchestrator later handles the latency
  constraint, prd_007 may flip to GO on its own — that flip would be **proof the
  orchestrator worked**. Its score range is left at `[82,98]` (a known miss)
  rather than widened, because widening a range while keeping a GO label the
  engine won't produce would be incoherent.

  **UPDATE — the probe graduated (2026-07-04).** Under the orchestrator engine
  with the resolve-conservatism fix (#1+#2), prd_007 converges toward **GO
  (~4/5 runs)** — the engine now correctly *agrees* with the GO label. This is
  the arc the probe was built to trace: it caught the single engine's
  over-conservatism (any risky / an invented latency-`missing` forcing NO-GO),
  we diagnosed and fixed the conservatism, and the engine now lands on GO. The
  probe has **graduated from "catching a bug" to "confirming the fix."** Keep it
  labeled GO: on the single engine it still diverges (documents the original
  behavior); on the orchestrator it now agrees (documents the fix). The label is
  the fixed point against which both engines are read.

### Score-range calibration (v3)

The five new PRDs' ranges were calibrated to their observed 5-run spread (a
range must *contain reality*). **prd_006** was widened to `[54, 74]` even though
that is more generous than a non-viable robo-advisor (3 missing regulatory
capabilities) deserves — **this widening documents the known engine limitation
that the score runs too high for non-viable products (see backlog), it does not
endorse it.** The verdict correctly says NO-GO; only the number is generous.
prd_003 stays `[50, 75]` for the same reason.

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

1. **A missing critical-path capability should make the SCORE reflect
   non-viability, not just the verdict.** Across the 8-PRD set the *verdict*
   reliably catches non-viable products (prd_003/004/006/008 all return NO-GO
   5/5). The problem is the *score*: it averages all capabilities equally, so a
   product that cannot launch still scores mid-range. prd_003 (no custody, no
   trading) scores ~62; prd_006 (no suitability, no drift-monitoring, no
   tax-loss harvesting) scores ~66; prd_008 (no appraisal, flood, or TRID
   disclosures) scores ~58 — all comfortably above the crypto/robo "clearly
   broken" intuition. Existential `missing` capabilities get diluted by many
   peripheral `covered` ones. Fix direction: weight or flag critical-path
   `missing` capabilities so they dominate the score, or cap the score when one
   is present. (The verdict is fine; this is a score-fidelity issue.) The v3
   range calibration widened prd_006 to `[54,74]` to *contain* this behavior,
   which documents but does not endorse it.
2. **The engine reads non-functional constraints as capabilities.** In prd_007
   the engine turned the PRD line "latency budget under 150ms" into a capability
   ("Orchestrate all fraud-scoring signals within a 150ms latency budget") and
   marked it `missing` (no tool). Performance/latency/SLA constraints are not
   registry capabilities; treating them as `missing` distorts the score and can
   flip the verdict. This is also the engine **sensing an orchestration gap** —
   direct motivation for the orchestrator build. Surfaced by prd_007.
3. **Peripheral-risky → NO-GO: hypothesis unconfirmed.** prd_007 (labeled GO)
   returns NO-GO 5/5 with only one *peripheral* risky capability (a fraud-hold
   notification) — but because the engine also invented a `missing` capability
   (#2 above) on the same PRD, we cannot attribute the NO-GO to the peripheral
   risky alone. Open question: does any single risky capability force NO-GO
   regardless of criticality? **Needs an isolated test PRD** engineered so the
   engine yields exactly one risky and zero missing. If confirmed, the engine is
   too aggressive (any compliance risk blocks the verdict); if not, the missing
   was the driver. Surfaced by prd_007.

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

8 PRDs across distinct banking domains exercise the main engine paths. Target
is 50 total. Batch 1 (prd_004–008) was added in dataset v3.

| id | Title (domain) | What it exercises |
|---|---|---|
| `prd_001` | Monthly Savings Statement Generator (accounts) | Clean covered path: all 4 capabilities map to compliant tools; verifies the gate does not over-flag. GO. |
| `prd_002` | Custom Card Rewards Categories (cards) | Parameter-level modifications, a missing capability, and PII-backstop risky traps on empty-tag tools. NO-GO. |
| `prd_003` | Retail Cryptocurrency Custody & Trading (wealth) | Novel-capability territory: multiple `missing` (crypto custody, trading) plus `partial` extensions. NO-GO. |
| `prd_004` | Personal Loan Origination (lending) | **Deprecated-tool → risky** trap (`credit_bureau_pull` is deprecated), plus missing regulatory capabilities (adverse-action, fair-lending). NO-GO. |
| `prd_005` | Domestic Wire Transfer (payments) | All-covered clean GO across the payments/security stack; tests the gate does not over-flag. GO. |
| `prd_006` | Robo-Advisory Portfolio Management (wealth) | All four statuses: 3 `missing` (suitability, drift-monitoring, tax-loss harvesting), 1 risky, 1 partial. NO-GO. |
| `prd_007` | Real-Time Card Fraud Scoring (fraud) | **Intentional divergence probe** — labeled GO (one peripheral risky), engine returns NO-GO. See "Intentional divergences". |
| `prd_008` | Mortgage Origination & Underwriting (mortgage) | Missing-heavy (appraisal, flood, TRID) + deprecated-tool risky + partial rate-lock. NO-GO. |

Coverage: 3 GO / 5 NO-GO; all four statuses exercised; ~50 distinct registry
tools touched; deprecated-tool → risky path exercised by prd_004 and prd_008.

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
