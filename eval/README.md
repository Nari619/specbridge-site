# SpecBridge Eval Harness

An offline accuracy harness for the SpecBridge analysis engine. It replays a
hand-labeled set of PRDs through the live analyze pipeline (the 100-tool
Supabase registry, the LLM matcher, the deterministic PII backstop, and the
compliance gate) and compares the engine's output to what a human labeler
expected.

**Status:** data foundation only. The dataset schema and 3 seeded PRDs are
in place; the runner is not built yet.

---

## What the harness measures

For each PRD in the dataset, the harness will:

1. POST the `prd_text` to `/api/analyze`.
2. Match each returned `capability` back to the labeled `expected_matches`
   entry (by best textual overlap on the `capability`/`requirement` fields).
3. Compare the returned `matched_tool` and `status` to the expected values.
4. Compare the top-level `verdict` and `readiness_score` to the expected
   verdict and score range.
5. Record the analyze call's input/output token counts and the resulting
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

## What's NOT in scope for this PR

- The runner itself — nothing in this folder executes anything yet.
- CI wiring — the harness will run locally first; CI hookup is later.
- Cost-optimization heuristics — token cost is measured, not tuned.
