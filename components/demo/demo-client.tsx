"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ScoreArc } from "@/components/score-arc";
import { CapabilityCard } from "@/components/demo/capability-card";
import { samplePrds } from "@/data/sample-prds";
import type { AnalysisResult, Capability } from "@/app/api/analyze/route";

type View = "pm" | "engineering" | "compliance";

const viewConfig: Record<
  View,
  { label: string; order: Capability["status"][] }
> = {
  pm: { label: "PM", order: ["partial", "missing", "risky", "covered"] },
  engineering: {
    label: "Engineering",
    order: ["covered", "partial", "missing", "risky"],
  },
  compliance: {
    label: "Compliance",
    order: ["risky", "missing", "partial", "covered"],
  },
};

const usd = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function DemoClient() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prd, setPrd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [view, setView] = useState<View>("pm");

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
      setView("pm");
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

  const totalSavings = result
    ? result.capabilities.reduce(
        (sum, c) => sum + (c.modification_plan?.est_savings_usd ?? 0),
        0,
      )
    : 0;

  const sortedCapabilities = result
    ? [...result.capabilities].sort(
        (a, b) =>
          viewConfig[view].order.indexOf(a.status) -
          viewConfig[view].order.indexOf(b.status),
      )
    : [];

  const verdictHeader = result && (
    <div className="flex flex-wrap items-center justify-between gap-8">
      <div>
        <p className="text-sm text-muted-foreground">Readiness report</p>
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
        <p className="mt-1 text-xs text-muted-foreground">
          This is a design-time estimate. Once{" "}
          <a href="/arc" className="text-brand hover:underline">
            ARC
          </a>{" "}
          has runtime data for these features, the estimate is corrected by
          what the agents actually cost.
        </p>
        {selectedId === "refund-processing" && (
          <a
            href="/arc"
            className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 transition-colors duration-200 ease-out hover:bg-brand/10"
          >
            <span className="text-sm">
              <span className="font-medium">
                This feature is live in production
              </span>
              <span className="block text-xs text-muted-foreground">
                Design-time estimate ~$0.38/task · ARC measured $3.64/task
                actual
              </span>
            </span>
            <span className="shrink-0 text-sm font-medium text-brand">
              See ARC&rsquo;s actual cost →
            </span>
          </a>
        )}
      </div>
      <ScoreArc value={result.readiness_score} />
    </div>
  );

  const viewBanner =
    result &&
    (view === "pm" ? (
      totalSavings > 0 && (
        <div className="rounded-xl border border-brand/30 bg-brand/5 px-5 py-4">
          <p className="text-sm font-medium">
            Modify instead of building new:{" "}
            <span className="text-brand">
              ~${usd.format(totalSavings)} in modeled savings
            </span>{" "}
            across {counts?.partial ?? 0}{" "}
            {(counts?.partial ?? 0) === 1 ? "capability" : "capabilities"}.
          </p>
        </div>
      )
    ) : view === "engineering" ? (
      <div className="rounded-xl border px-5 py-4">
        <p className="text-sm font-medium">
          {counts?.covered ?? 0}{" "}
          {(counts?.covered ?? 0) === 1 ? "tool is" : "tools are"} ready to
          reuse as-is — schemas, examples, and repo pointers below.
        </p>
      </div>
    ) : (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-5 py-4">
        <p className="text-sm font-medium text-amber-600 dark:text-amber-500">
          {(counts?.risky ?? 0) + (counts?.missing ?? 0)} capabilities need
          review before kickoff: {counts?.risky ?? 0} with compliance flags,{" "}
          {counts?.missing ?? 0} with no existing tool.
        </p>
      </div>
    ));

  const cards = (
    <div className="space-y-3">
      {sortedCapabilities.map((cap) => (
        <CapabilityCard
          key={`${view}-${cap.requirement}`}
          capability={cap}
        />
      ))}
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {samplePrds.map((sample) => (
          <button
            key={sample.id}
            type="button"
            onClick={() => selectSample(sample.id)}
            className={`rounded-md border px-4 py-1.5 text-sm transition-colors duration-200 ease-out ${
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
          className="bg-brand px-5 text-white transition-colors duration-200 ease-out hover:bg-brand/90"
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
          <div className="space-y-8 p-6 md:p-10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="inline-flex rounded-lg border p-1">
                {(Object.keys(viewConfig) as View[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={`rounded-md px-4 py-1.5 text-sm transition-colors duration-200 ease-out ${
                      view === v
                        ? "bg-brand/10 font-medium text-brand"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {viewConfig[v].label}
                  </button>
                ))}
              </div>
              {counts && (
                <p className="text-sm text-muted-foreground">
                  {(["covered", "partial", "risky", "missing"] as const)
                    .filter((s) => counts[s])
                    .map((s) => `${counts[s]} ${s}`)
                    .join(" · ")}
                </p>
              )}
            </div>

            {view === "pm" && (
              <>
                {verdictHeader}
                {viewBanner}
                {cards}
              </>
            )}
            {view === "engineering" && (
              <>
                {viewBanner}
                {cards}
                {verdictHeader}
              </>
            )}
            {view === "compliance" && (
              <>
                {viewBanner}
                {verdictHeader}
                {cards}
              </>
            )}

            <div className="rounded-xl bg-muted/50 p-5">
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
