# Pre-demo checklist

Run through this before a live demo or judging session.

## Must-do
- [ ] **Production env vars set in Vercel** — `ANTHROPIC_API_KEY`,
      `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Without them
      the demo falls back to the 25-tool static registry and the dashboard/
      twin-catcher go quiet.
- [ ] **Twin-catcher demo pairs present.** The "similar PRD detected" moment
      depends on two seeded PRDs in the `analyses` table. If the table was
      cleared, recreate them from the repo:
      ```
      npx tsx --env-file=.env.local eval/seed-demo-twins.ts
      ```
      Then analyze a fraud PRD (fires the fraud twin ~95%) or a personal-loan
      PRD (fires the lending twin ~71%).
- [ ] **Smoke the live demo** — run one sample PRD end-to-end, confirm the
      report renders and the score arc animates.
- [ ] **Production engine is `single`** — `ANALYZE_ENGINE` unset (default).
      The orchestrator variants are flagged-off and NOT for production (they
      lost on the compliance gate; see docs/orchestrator-design.md §9).

## Optional (if budget allows)
- [ ] **Refresh the eval baseline** (~$3, one `--runs=5`). The committed
      `--runs=5` baseline was scored before the prd_003 `market_data_feed`
      label was corrected (partial→covered, 2026-07-04), so it *slightly
      understates* the single engine's gate accuracy. It is conservative, not
      misleading, and no decision depends on it — refresh only if you want the
      canonical baseline exact for a numbers-heavy discussion:
      ```
      npm run eval -- --runs=5
      ```

## Talking points ready
- [ ] The **deterministic compliance gate** is code, not model opinion — the
      moat. (Point at a RISKY row: the tag it's missing is read from the
      registry by code.)
- [ ] The **eval-gated methodology**: locked baseline, one-variable fixes,
      pre-committed promotion rule — we measured an agentic orchestrator and
      *declined to ship it* because it couldn't beat the gate. That discipline
      is the product.
- [ ] The **twin-catcher**: "two teams about to build the same thing," caught
      at the moment of the build decision, with the specific shared capabilities.
