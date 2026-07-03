# Orchestrator + Tool-Using Agent — Design of Record

Status: **approved design, not yet built.** Rollout is phased and eval-gated
(see §7). This document is the design of record; the promotion criteria in §7
are binding and must not be weakened to ship a change.

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
