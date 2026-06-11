"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ScoreArc } from "@/components/score-arc";
import { samplePrds } from "@/data/sample-prds";
import type { AnalysisResult } from "@/app/api/analyze/route";

const statusMeta: Record<
  AnalysisResult["capabilities"][number]["status"],
  { label: string; dot: string; text: string }
> = {
  covered: { label: "Covered", dot: "bg-brand", text: "text-muted-foreground" },
  partial: {
    label: "Partial",
    dot: "border-[1.5px] border-brand",
    text: "text-muted-foreground",
  },
  risky: {
    label: "Risky",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-500",
  },
  missing: {
    label: "Missing",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
  },
};

const usd = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function DemoClient() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prd, setPrd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  function selectSample(id: string) {
    const sample = samplePrds.find((p) => p.id === id);
    if (!sample) return;
    setSelectedId(id);
    setPrd(sample.body);
  }

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setResult(data as AnalysisResult);
    } catch {
      setError("Couldn't reach the analysis service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const counts = result
    ? result.capabilities.reduce(
        (acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }),
        {} as Record<string, number>,
      )
    : null;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {samplePrds.map((sample) => (
          <button
            key={sample.id}
            type="button"
            onClick={() => selectSample(sample.id)}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              selectedId === sample.id
                ? "border-brand bg-brand/10 text-brand"
                : "text-muted-foreground hover:border-brand/40 hover:text-foreground"
            }`}
          >
            {sample.title}
          </button>
        ))}
      </div>

      <textarea
        value={prd}
        onChange={(e) => {
          setPrd(e.target.value);
          setSelectedId(null);
        }}
        placeholder="Paste your PRD here, or pick a sample above…"
        rows={10}
        className="mt-4 w-full resize-y rounded-2xl border bg-card p-5 text-sm leading-relaxed shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Button
          size="lg"
          className="bg-brand px-6 text-white hover:bg-brand/90"
          disabled={loading || prd.trim().length === 0}
          onClick={runAnalysis}
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span className="size-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
              Analyzing…
            </span>
          ) : (
            "Run analysis"
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          Demo runs against a seeded registry of 25 sample tools.
        </p>
      </div>

      {error && (
        <p className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="mt-12 overflow-hidden rounded-2xl border bg-card shadow-sm"
        >
          <div className="p-6 md:p-10">
            <div className="flex flex-wrap items-center justify-between gap-8">
              <div>
                <p className="text-sm text-muted-foreground">
                  Readiness report
                </p>
                <p
                  className={`mt-2 text-5xl font-semibold tracking-tight ${
                    result.verdict === "GO"
                      ? "text-brand"
                      : "text-amber-600 dark:text-amber-500"
                  }`}
                >
                  {result.verdict}
                </p>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {result.verdict_reasoning}
                </p>
                <p className="mt-4 text-xs text-muted-foreground">
                  Est. run cost at forecast volume: $
                  {usd.format(result.est_monthly_cost_usd.low)}–
                  {usd.format(result.est_monthly_cost_usd.high)}/mo · modeled
                </p>
              </div>
              <ScoreArc value={result.readiness_score} />
            </div>

            {counts && (
              <p className="mt-8 text-sm text-muted-foreground">
                {(["covered", "partial", "risky", "missing"] as const)
                  .filter((s) => counts[s])
                  .map((s) => `${counts[s]} ${s}`)
                  .join(" · ")}
              </p>
            )}

            <ul className="mt-4 divide-y border-t">
              {result.capabilities.map((cap, i) => (
                <li key={i} className="py-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span
                      className={`size-2 shrink-0 rounded-full ${statusMeta[cap.status].dot}`}
                    />
                    <span
                      className={`w-16 text-xs font-medium tracking-wide uppercase ${statusMeta[cap.status].text}`}
                    >
                      {statusMeta[cap.status].label}
                    </span>
                    <span className="font-medium">{cap.requirement}</span>
                    {cap.matched_tool && (
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {cap.matched_tool}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 pl-6 text-sm text-muted-foreground md:pl-24">
                    {cap.justification}
                  </p>
                </li>
              ))}
            </ul>

            <div className="mt-8 rounded-xl bg-muted/50 p-5">
              <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
                Top blocker
              </p>
              <p className="mt-2 text-sm font-medium">{result.top_blocker}</p>
              <p className="mt-3 text-xs font-medium tracking-widest text-muted-foreground uppercase">
                Unblock path
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {result.unblock_path}
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
