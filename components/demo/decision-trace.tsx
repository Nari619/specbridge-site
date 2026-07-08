"use client";

import { useState } from "react";
import type { AnalysisResult, Capability } from "@/app/api/analyze/route";

const STATUS_WEIGHT: Record<string, number> = {
  covered: 1,
  partial: 0.5,
  risky: 0.35,
  missing: 0,
};

/** Reconstruct the gate's decision for one risky capability, from the result. */
function riskyDetail(c: Capability): {
  tags: string[];
  required: string[];
  missing: string[];
  deprecated: boolean;
} {
  const tags = c.reuse?.compliance_tags ?? [];
  const required = c.required_clearances ?? [];
  const missing = required.filter((r) => !tags.includes(r));
  // Risky with no missing clearance ⇒ the trigger was a deprecated tool.
  return { tags, required, missing, deprecated: missing.length === 0 };
}

/**
 * "How SpecBridge decided" — an audit trail of the ACTUAL production pipeline
 * for this analysis, reconstructed entirely from the returned result (no engine
 * changes, no new data). Centers the deterministic compliance gate: the exact
 * registry tags that made each RISKY flag, decided by code, not the model.
 *
 * Collapsed by default in the product; pass defaultExpanded for the live demo.
 */
export function DecisionTrace({
  result,
  defaultExpanded = false,
}: {
  result: AnalysisResult;
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  const caps = result.capabilities;
  const n = caps.length;
  const counts = { covered: 0, partial: 0, risky: 0, missing: 0 };
  for (const c of caps) counts[c.status] += 1;
  const risky = caps.filter((c) => c.status === "risky");
  const passedGate = counts.covered + counts.partial;

  return (
    <div className="overflow-hidden rounded-xl border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors duration-200 ease-out hover:bg-muted/50"
      >
        <span className="min-w-0">
          <span className="text-sm font-semibold tracking-tight">
            How SpecBridge decided
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {n} capabilit{n === 1 ? "y" : "ies"}
            {counts.risky > 0 && (
              <>
                {" · "}
                <span className="font-medium text-amber-600 dark:text-amber-500">
                  {counts.risky} RISKY flag{counts.risky === 1 ? "" : "s"} set by code
                </span>
              </>
            )}
            {" · "}
            {open ? "hide the decision trail" : "view the decision trail"}
          </span>
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="space-y-6 border-t px-5 py-5 text-sm">
          {/* 1. Decomposition */}
          <section>
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              1 · Decomposition
            </p>
            <p className="mt-2 leading-relaxed">
              SpecBridge read the PRD and broke it into{" "}
              <span className="font-medium">{n} atomic capabilities</span> — one
              system action each.
            </p>
          </section>

          {/* 2. Matching */}
          <section>
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              2 · Registry matching
            </p>
            <p className="mt-2 leading-relaxed">
              Each capability was matched against the 100-tool enterprise
              registry. The model classifies <em>functional fit only</em> —
              covered, partial, or missing.{" "}
              <span className="text-muted-foreground">
                It is never allowed to decide compliance.
              </span>
            </p>
            <p className="mt-2 text-muted-foreground">
              {counts.covered} covered · {counts.partial} needs modification ·{" "}
              {counts.missing} no tool (missing).
            </p>
          </section>

          {/* 3. The gate — centerpiece */}
          <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-xs font-medium tracking-widest text-amber-700 uppercase dark:text-amber-500">
              3 · Compliance gate — decided by code, not the model
            </p>
            {risky.length === 0 ? (
              <p className="mt-2 leading-relaxed">
                No capability was flagged RISKY: every matched tool carried the
                clearances its capability required. The gate ran, found no gap,
                and changed nothing.
              </p>
            ) : (
              <>
                <p className="mt-2 leading-relaxed">
                  <span className="font-medium">
                    {risky.length} capabilit{risky.length === 1 ? "y" : "ies"}{" "}
                    flagged RISKY.
                  </span>{" "}
                  This step is pure code (<code className="font-mono text-xs">applyComplianceRules</code>)
                  reading the registry — the model has no say.
                </p>
                <ul className="mt-3 space-y-3">
                  {risky.map((c, i) => {
                    const d = riskyDetail(c);
                    return (
                      <li key={i} className="border-l-2 border-amber-500/40 pl-3">
                        <p className="font-medium">{c.requirement}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          matched{" "}
                          <code className="font-mono text-foreground">
                            {c.matched_tool}
                          </code>
                          {d.deprecated ? (
                            <>
                              {" "}
                              → tool is{" "}
                              <span className="font-medium text-amber-600 dark:text-amber-500">
                                deprecated
                              </span>{" "}
                              → code set{" "}
                              <span className="font-medium">RISKY</span>
                            </>
                          ) : (
                            <>
                              {" "}
                              → registry tags:{" "}
                              <span className="font-mono">
                                [{d.tags.join(", ") || "none"}]
                              </span>{" "}
                              · requires:{" "}
                              <span className="font-mono">
                                [{d.required.join(", ")}]
                              </span>{" "}
                              · missing:{" "}
                              <span className="font-mono font-medium text-amber-600 dark:text-amber-500">
                                {d.missing.join(", ")}
                              </span>{" "}
                              → code set{" "}
                              <span className="font-medium">RISKY</span>
                            </>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {passedGate > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                The other {passedGate} matched capabilit
                {passedGate === 1 ? "y" : "ies"} passed the gate — required
                clearances present, or none needed.
              </p>
            )}
          </section>

          {/* 4. Scoring */}
          <section>
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              4 · Readiness score — deterministic
            </p>
            <p className="mt-2 leading-relaxed">
              A fixed weighting, not a model guess: covered=1.0, partial=0.5,
              risky=0.35, missing=0.
            </p>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              ({counts.covered}×1.0 + {counts.partial}×0.5 + {counts.risky}×0.35
              + {counts.missing}×0) ÷ {n} ={" "}
              <span className="font-medium text-foreground">
                {result.readiness_score} / 100
              </span>
            </p>
          </section>

          {/* 5. Verdict */}
          <section>
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              5 · Verdict
            </p>
            <p className="mt-2 leading-relaxed">
              <span
                className={`font-semibold ${result.verdict === "GO" ? "text-brand" : "text-amber-600 dark:text-amber-500"}`}
              >
                {result.verdict}
              </span>{" "}
              — SpecBridge&rsquo;s recommendation, grounded in the code-decided
              gate and score above. Top blocker:{" "}
              <span className="text-muted-foreground">{result.top_blocker}</span>
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
