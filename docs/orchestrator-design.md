# Orchestrator + Tool-Using Agent — Design of Record

Status: **Explored, measured across six configurations — NOT promoted; closed
(see §9-§10).** Two orchestrator architectures were built and eval-gated: the
decompose/resolve split (`orchestrator_p1`) and the holistic retrieval-augmented
single call (`holistic`). Both improved precision (up to +20pts) and cost (−52%)
but neither matched the single engine's compliance-gate accuracy (best 0.790 vs
0.883). By the pre-committed rules, **production stays on the single engine**; both
variants live behind `ANALYZE_ENGINE` (default `single`). The promotion criteria
were binding and held. Orchestrator exploration is closed.

---

## 0. Why we're doing this (and why this shape)

The locked 8-PRD distribution baseline (`eval/results/latest.json`, dataset v3)
tells us exactly where the engine is weak and where it is already strong:

| Metric | baseline (mean ± σ) | reading |
|---|---|---|
| match_precision | 68.4% ± 3.3 | **weak — this is the target** |
| match_recall | 95.5% ± 2.0 | already strong — protect it |
| compliance_gate_accuracy | 88.3% ± 4.1 | already strong, code-owned — protect it |
| verdict_accuracy | 87.5% (7/8) | 1 miss is prd_007, an intentional probe |

Plus two engine findings from prd_007: the engine reads a **non-functional
constraint** ("latency < 150ms") as a `missing` capability, and it appears to
force NO-GO on any risky (unconfirmed). The first is direct evidence the engine
is "sensing an orchestration gap."

**Design principle: target the measured weakness (precision), structurally
protect what already works (recall, gate). This is an accuracy investment, not
an agentic-ness exercise.** Every choice below is justified by which metric it
moves. The single biggest precision lever is replacing "cram all 100 tools into
a 22k-token prompt and pick" with "retrieve a handful of relevant candidates per
requirement, verify parameter fit, and reason where the choice is genuinely
ambiguous."

---

## 1. Non-negotiables (the moat)

These two rules are binding. They may not be relaxed for any reason, including
"it would be more agentic" or "it would be simpler."

### 1a. Agent proposes, code disposes

The deterministic compliance gate (`applyComplianceRules` + `deterministicPiiScan`
+ `KNOWN_CLEARANCES` + the deprecated check + `STATUS_WEIGHTS`) **runs in code,
AFTER the agent finishes, on the final assembled capabilities, and overrides
anything the agent said.**

- The agent assigns only *functional* status (`covered` / `partial` / `missing`)
  and a `matched_tool`. It **never** assigns `risky`.
- Code re-derives `risky` from the matched tool's `compliance_tags` and `status`,
  exactly as today. If the agent says `covered` but the tool lacks a required
  clearance, code flips it to `risky`. Full stop.
- The `check_compliance_tags` tool (§2) is **advisory** — it helps the agent
  pick better tools; it is not the gate. An agent that ignores it entirely
  cannot corrupt the outcome, because code re-decides.
- **The gate is never in the agent's control surface.** Gate accuracy is
  therefore *structurally* protected: the orchestrator cannot regress it. It can
  only improve effective outcomes by feeding the gate better-chosen tools.

This is the moat. We never trade it for "more agentic."

### 1b. Promotion criteria (the eval gate cannot be cheated)

The orchestrator **ships behind a flag** and does **not** replace the single-call
engine until a `--runs=5` distribution proves, versus the locked baseline
(precision 68.4 ± 3.3, recall 95.5 ± 2.0, gate 88.3 ± 4.1):

1. **match_precision mean ↑ by more than the combined spread** — it must clear
   roughly **+4 points** to count as signal, not noise.
2. **match_recall mean ≥ 93.5%** (within σ of baseline). Do not sacrifice the
   thing that already works.
3. **compliance_gate_accuracy mean ≥ 84%** (within σ; structurally protected
   regardless).
4. The prd_007 non-functional finding is resolved (latency no longer produces a
   `missing` capability).

**If the orchestrator does not beat the baseline on these terms, we do not ship
it. That is a legitimate outcome, not a failure.** "More agentic but not more
accurate" is a reason to stop, not to ship.

---

## 2. The four tools

Three are **deterministic (no Claude call)**; one is a focused LLM micro-call.
That split is deliberate — it keeps cost and reproducibility under control.

### `search_registry(requirement, k=6) → Candidate[]`
- **Purpose:** given ONE requirement, return the top-k candidate tools — replacing
  "all 100 in the prompt." Narrowing the choice set is the biggest precision
  lever.
- **Returns:** `[{ tool_id, name, category, description_snippet, relevance }]`, ranked.
- **Impl:** deterministic retrieval over `name + description + category`.
  **BM25 for v1** (zero infra); embeddings only if measurement proves
  candidate-recall is the bottleneck. No LLM.

### `fetch_schema(tool_id) → ToolDetail`
- **Purpose:** full detail for a candidate under serious consideration.
- **Returns:** the existing `RegistryTool` shape —
  `{ name, description, input_parameters[], owner_team, version, compliance_tags, status, est_cost_per_call_usd }`.
- **Impl:** deterministic DB read (reuses `lib/registry-source`). Surfaces
  `status: "deprecated"` and `compliance_tags` so the agent sees what the gate
  will enforce.

### `check_compliance_tags(tool_id, requirement_text, declared_clearances) → ComplianceResult`
- **Purpose:** expose the existing deterministic gate logic as an **advisory**
  tool so the agent can reason with it — the logic stays in code, unchanged.
- **Returns:** `{ required_clearances, tool_tags, missing_clearances, deprecated, deterministic_status: "ok" | "risky" }`.
- **Impl:** same computation as `applyComplianceRules` + `deterministicPiiScan`:
  `required = piiBackstop(requirement_text) ∪ (declared_clearances ∩ KNOWN_CLEARANCES)`;
  `risky` if `missing ≠ ∅` or `deprecated`. **No LLM. Advisory only (see §1a).**

### `verify_parameter_fit(requirement, tool_id) → FitResult`
- **Purpose:** the capability we lack today — does this tool's *parameters*
  actually satisfy the requirement, or is there a gap (→ `partial`)? Separates
  `covered` from `partial` on evidence, not vibes.
- **Returns:** `{ fit: "full" | "partial" | "none", missing_inputs: string[], rationale }`.
- **Impl:** **LLM micro-call** (requirement + one tool's schema, ~600 tokens in).
  This is the precision lever — we do not cheap out on it with a name-match
  heuristic. It is the main new cost driver (§6).

---

## 3. The orchestrator: what it decides

**Plan the requirements upfront; resolve each requirement adaptively.** Not a
fully pre-planned tool sequence (brittle), not fully improvised (expensive).

**Phase A — Decompose (1 call).** One Claude call turns the PRD into requirements.
This is essentially today's decomposition (the source of 95% recall) and we keep
it. One addition: it classifies each requirement as **functional (a capability)**
vs **non-functional (a constraint: latency, SLA, volume)**. Non-functional
requirements are recorded but **not sent to registry matching** — this kills the
prd_007 "latency-as-a-missing-capability" bug at the source.

**Phase B — Per-requirement resolution loop.** For each functional requirement,
the orchestrator runs a tool loop and chooses **depth by confidence**:

- **Shallow (most requirements):** `search_registry` returns a dominant top
  candidate (high relevance, clear gap to #2). Agent runs `check_compliance_tags`
  + one `verify_parameter_fit`, assigns status, done. ~1 micro-call.
- **Deep (ambiguous requirements):** triggered when top-1 vs top-2 relevance is
  close, OR `verify_parameter_fit` returns `partial`/`none`, OR nothing is
  relevant (likely `missing`). Then `fetch_schema` on 2–3 candidates,
  `verify_parameter_fit` on each, compare, decide. ~2–4 micro-calls.

The depth decision is the efficiency story: obvious matches (KYC →
`kyc_verification_service`) are shallow and cheap; genuinely ambiguous ones
(personalized pricing → `interest_rate_service` or `missing`?) go deep — and
deep is exactly where today's single call makes its precision mistakes. **We
spend reasoning budget where the tool choice is hard.**

Per requirement the agent outputs: `matched_tool`, functional status
(`covered`/`partial`/`missing` — never `risky`), `required_clearances`, and a
rationale.

---

## 4. End-to-end flow per PRD

```
PRD
 └─▶ [A] Decompose (1 Claude call)
        → functional requirements[]  + non-functional constraints[] (parked)
 └─▶ [B] For each functional requirement:
        1. search_registry(req)            [deterministic BM25]
        2. triage → shallow | deep
        3. fetch_schema(candidate)         [deterministic]
        4. verify_parameter_fit(req, tool) [Claude micro-call]
        5. check_compliance_tags(...)      [deterministic, advisory]
        6. agent assigns functional status + matched_tool + required_clearances
 └─▶ [C] Assemble capabilities[]
 └─▶ [D] CODE re-runs deterministicPiiScan + applyComplianceRules   ← THE GATE, unchanged
 └─▶ [E] CODE computes readiness_score (STATUS_WEIGHTS)             ← unchanged
 └─▶ [F] Synthesis (1 Claude call): verdict prose, top_blocker, unblock_path
 └─▶ save (result + agent_trace) → return
```

Steps **D and E are byte-identical to today.** The orchestrator changes only
**A–C** (how capabilities and tools are chosen). Everything downstream is the
moat, untouched.

---

## 5. Agent step trace (audit trail)

Every tool call and decision is recorded into a structured `agent_trace`,
persisted alongside the analysis (extend the Supabase `analyses` row /
`full_result` jsonb; surface in the Evidence Pack).

- **Per tool call:** `{ step, requirement_id, tool, args, result_summary, duration_ms, ts }`
- **Per requirement decision:** `{ requirement_id, candidates_considered[], chosen_tool, depth, parameter_fit, compliance_check, final_functional_status, rationale }`
- **Per PRD:** ordered list + totals (`n_calls`, `n_deep`, `total_tokens`, `total_cost`).

This delivers the agent step trace the project audit found missing, and it is a
precision-debugging goldmine: when the eval flags a wrong tool pick, the trace
shows which candidates were considered and why the agent chose wrong — something
the opaque single call can never reveal. It also strengthens governance: every
match becomes explainable and auditable.

---

## 6. Cost and demo latency

**Today:** 1 call/PRD, but heavy — ~22k input tokens (whole registry embedded) +
~2.5k output ≈ **$0.11/PRD**.

**New design, per PRD:**

| Step | Calls | Notes |
|---|---|---|
| Decompose | 1 | PRD only, **no registry in prompt** (~1.5k in) |
| search / fetch / check_compliance | 0 | deterministic |
| verify_parameter_fit | ~8–18 | 1 per shallow req + 2–3 per deep req; tiny prompts |
| Synthesis | 1 | assembled caps → verdict prose |
| **Total** | **~10–20 Claude calls/PRD** | |

**Cost:** the offset is that we delete the 22k-token registry from every prompt
(retrieval replaces it); the new calls are small. Honest range **$0.08–0.16/PRD**
— roughly comparable to today, ±50%, not a blowup. Smaller calls also fail more
gracefully (a bad micro-call can be retried without redoing the whole PRD).

**Demo latency — watch this.** The multi-call loop is sequential, so wall-clock
goes up 2–4×. **If a demo analysis exceeds ~20s wall-clock, that is a
competition-experience problem.** Mitigation, in order:
1. Parallelize independent per-requirement resolutions (they don't depend on
   each other).
2. **Batching fallback:** resolve all requirements in a single "resolution" call
   over pre-retrieved candidates (2–3 calls total). Cheaper and faster, less
   adaptive. Reach for this if the full loop pushes demo latency past ~20s or
   doesn't earn its accuracy keep on the eval.

Demo experience matters for the competition; latency is a first-class constraint,
not an afterthought.

---

## 7. Phased, eval-gated rollout (non-negotiable)

Each phase gets its own before/after `--runs=5` so we learn exactly what each
piece contributes and can isolate any regression by cause. Each phase is
independently revertable. Promotion to "default engine" requires the §1b criteria.

1. **Phase 1 — Retrieval, registry-out-of-prompt, single resolution call.** Add
   `search_registry`; keep one resolution call that now reasons over retrieved
   candidates instead of all 100 tools. *Hypothesis: precision ↑ from a narrower,
   more relevant choice set; recall flat.*
2. **Phase 2 — Parameter-fit.** Add `verify_parameter_fit`. *Hypothesis: the
   covered/partial boundary sharpens; precision ↑.*
3. **Phase 3 — Per-requirement deep/shallow loop + non-functional filtering.**
   Full orchestrator. *Hypothesis: precision ↑ on ambiguous PRDs; prd_007 latency
   bug fixed (possibly flipping prd_007 to GO — the designed proof the
   orchestrator worked).*

If any phase regresses recall or gate beyond σ, stop and diagnose with the agent
trace before proceeding.

**Why each headline metric is protected by construction:**
- **Recall** — decomposition is essentially unchanged (it earns the 95%).
- **Gate** — re-run in code; the agent can't touch it (§1a).
- **Precision** — the only metric we deliberately move (retrieval + parameter-fit
  + deep-on-ambiguous).
- **prd_007** — non-functional filtering removes the latency-as-capability bug.

---

## 8. Resolved design decisions

1. `verify_parameter_fit`: **LLM micro-call** (it's the precision lever).
2. Retrieval backend: **BM25 first**; prove candidate-recall is the bottleneck
   before adding embedding infrastructure.
3. Rollout: **phased, eval-gated**, each phase with its own before/after
   `--runs=5`.
4. This document is the committed design of record, including the binding
   promotion criteria (§1b).

---

## 9. Phase 1 outcome — measured, NOT promoted (2026-07-04)

**Result: the orchestrator did not clear the promotion bar. Production stays on
the single engine.** This is the disciplined outcome, not a failure — a
governance tool is exactly the thing that must hold the line when a shinier
architecture can't match its moat metric. The full evidence:

### The hypothesis
Replace "cram all 100 tools into a 22k-token prompt and pick" with
**per-requirement BM25 retrieval → reason over ~6 relevant candidates**. Narrower
choice set → higher tool-pick precision (the measured weak metric, 68.4%),
without touching recall or the code-owned gate.

### The method
Baseline (locked 8-PRD `--runs=5` distribution) → build behind a flag → change
**one variable at a time** → re-measure `--runs=5` → apply a **pre-committed
decision rule** (§1b). No goalpost-moving: the rule was written before the
numbers.

### The full arc (all `--runs=5`)

| Metric | Baseline | v1 | #1+#2 | #3 | sweet-spot | Bar |
|---|---|---|---|---|---|---|
| match_precision | 0.684 | 0.682 | 0.740 | 0.915 | **0.879** | > baseline ✅ |
| match_recall | 0.955 | 0.935 | 0.938 | 0.833 | **0.914** | ≥ 0.935 ❌ |
| compliance_gate_accuracy | 0.883 | 0.743 | 0.743 | 0.703 | **0.763** | ≥ 0.84 ❌ |
| verdict_accuracy | 0.875 | 0.875 | 0.975 | 1.000 | **1.000** | — |
| cost / PRD | $0.109 | $0.074 | $0.069 | $0.052 | $0.059 | — |

- **v1:** precision flat, gate regressed to 0.743. The eval gate caught it.
- **#1+#2:** recalibrated resolve's status rubric to our own labeling standard,
  and dropped `input_parameters` from the payload. Precision +5.6pts, verdict
  0.975 — but gate unchanged.
- **#3:** constrained decompose granularity. Precision soared to 0.915 but
  over-merged → recall crashed to 0.833. A trade, not a win.
- **sweet-spot:** decompose tuned for completeness (every explicit action) +
  no atomization. Best balance — recall recovered to 0.914, gate to its high of
  0.763 — still short of both bars.

### The regression, caught by the agent trace
v1 regressed gate by ~14pts. The **agent step trace** (built into the
orchestrator) made the diagnosis possible: it showed resolve was **inventing
unstated requirements** ("the description doesn't confirm as-of-date / crypto
ticker → partial") — the exact thing we forbid *labelers* from doing — and that
handing it full `input_parameters` triggered the nitpicking. A second trace
diagnosis classified the residual gate misses as **(a) pairing/granularity**
(decompose dropping or atomizing capabilities) vs **(b) genuine status
divergence**, and found the misses were overwhelmingly (a), with the only (b)
cases being borderline covered-vs-partial calls where the orchestrator is
arguably right. That distinction is what told us the ceiling was a granularity
artifact worth one more shot — not structural.

### The honest outcome, and precisely why
`gate = 0.763 < 0.84` and `recall = 0.914 < 0.935` — two bars unmet → no
promotion. Notably, **6 of 8 PRDs clear the gate bar** (prd_001 1.00, prd_005
0.94, prd_004 0.89, prd_007 0.86, prd_008 0.85, prd_006 0.78); the aggregate is
blocked by **two mixed-status PRDs, prd_002 (0.34) and prd_003 (0.46)**, which
resist even the sweet-spot granularity. Add **2–4× worse wall-clock latency**
(two sequential calls — a real demo concern) and the case to hold is clear. The
single engine remains better on **the compliance gate — our governance moat.**

### The genuine wins that just didn't clear the moat metric
- **Precision +20pts** (0.684 → 0.879) — the retrieval-narrowing hypothesis was
  right about precision.
- **Cost −46%** ($0.109 → $0.059) — the 22k-token registry left the prompt.
- **Verdict 0.875 → 1.000**, and the prd_007 divergence probe **graduated**
  (now agrees with its GO label).
- Real infrastructure, kept: the shared `analyze-core.ts` gate, the locked BM25
  retrieval (`lib/retrieval.ts`, 100%@6), the resolve truncation guard, and the
  agent step trace.

### Revisit ideas (if we return to this)
1. **Holistic retrieval-augmented single call** — keep the precision/cost win of
   registry-out-of-prompt (retrieve candidates) but drop the decompose/resolve
   *split*, doing decompose+match in ONE call over the retrieved candidates. The
   diagnosis suggests the split — not retrieval — is what hurt gate; this variant
   tests that directly.
2. **Per-PRD gate investigation on prd_002 / prd_003** — the two aggregate
   blockers; determine how much is granularity we can still close vs. borderline
   labels where the engine is arguably right.

### The meta-point (the actual deliverable)
The eval-gated methodology is the product here, not the orchestrator. It
established a stable distribution baseline, caught a regression the moment it
appeared, diagnosed the cause from a first-class agent trace, and made an
**evidence-based no-ship call against a pre-committed rule** — spending ~$15 of a
$30 budget to reach a decisive, defensible answer. That discipline is what makes
SpecBridge a governance tool rather than a demo.

---

## 10. Final experiment — holistic retrieval-augmented single call (2026-07-04)

Revisit idea #1 above, run as the decisive final experiment. Motivated by our own
Q2 diagnosis and independently confirmed by external AI review: orchestrator_p1's
**per-requirement isolation destroyed cross-capability context** — in banking a
status often depends on relationships between capabilities (an upstream KYC gap
makes a downstream capability risky; one capability partially covers another).
The isolated resolve can't see this; the single engine can.

**The variant (`ANALYZE_ENGINE=holistic`):** keep decompose (recall) and BM25
retrieval, but **UNION + dedupe** all retrieved candidates into one set (~15-20
tools) and do the matching in **ONE holistic call over all requirements + all
candidates together** — like the single engine, but over a retrieved subset
instead of all 100 tools. Same deterministic gate/score (analyze-core).

**Pre-committed rule:** promote iff gate ≥ 0.84 AND recall ≥ 0.935 AND precision
≥ baseline; else keep the single engine and stop (no Solutions 2/3/4).

**Result (`--runs=5`):** precision **0.886**, recall **0.914**, gate **0.790**,
verdict **1.000**, cost **$0.052/PRD (−52%)**.

**Decision: NOT promoted.** gate 0.790 < 0.84 and recall 0.914 < 0.935.

**What it proved.** The cross-capability hypothesis was *correct and validated*:
holistic is the best orchestrator variant on every axis, its gate (0.790) is the
highest of all six configurations, and **prd_003 recovered from 0.46 → 0.71** as
the holistic call restored the KYC/AML context the isolated split had dropped.
**7 of 8 PRDs clear the gate bar**; the aggregate is blocked essentially by a
single PRD (prd_002, gate 0.20), and recall is capped by decompose granularity.
But the decisive finding stands: **holistic judgment over a *retrieved subset*
narrowed the gap yet could not match the single engine's holistic judgment over
the *full registry* on the compliance gate — our moat.** Six measured
configurations, one conclusion: the single engine wins on the metric that matters
most for governance. Orchestrator exploration is closed.

### Three-way independent convergence

Three independent analyses picked the *same* fix as #1, before it was built:
1. **Our own agent-trace diagnosis** (the Q2 classification: isolation, not
   retrieval, was destroying cross-capability status judgment).
2. **This design doc's own §9 revisit-idea #1**, written at the split's close-out.
3. **An external AI review**, which independently identified per-requirement
   isolation as the root cause and holistic-single-call-over-retrieved-candidates
   as the remedy.

That convergence is itself a result worth recording: three separate lines of
reasoning agreed on the mechanism *and* the fix — and when we built exactly that
fix and measured it against a pre-committed bar, it still could not beat the
single engine on the governance moat. The methodology (locked baseline →
one-variable experiments → agent-trace diagnosis → pre-committed decision rule)
did not just pick a direction; it kept us honest when the well-motivated,
independently-endorsed fix turned out to be second-best. **That discipline — not
any single engine — is the durable asset.**

> Footnote on numbers: the gate figures in this section were measured before the
> 2026-07-04 `market_data_feed` label correction (prd_003, partial → covered).
> That correction helps *both* engines by one capability on one PRD and does not
> approach the ~9-point single-vs-holistic gate gap, so the conclusion is
> unchanged. If an exact refreshed baseline is wanted, re-run `--runs=5` on the
> single engine.
