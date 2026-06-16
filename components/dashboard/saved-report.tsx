import { ScoreArc } from "@/components/score-arc";
import { CapabilityCard } from "@/components/demo/capability-card";
import type { AnalysisResult } from "@/app/api/analyze/route";

const usd = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * Read-only render of a saved analysis, reusing the demo's CapabilityCard and
 * ScoreArc so a re-opened report looks the same as the live one.
 */
export function SavedReport({ result }: { result: AnalysisResult }) {
  const counts = result.capabilities.reduce(
    (acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="space-y-8 p-6 md:p-10">
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
              {usd.format(result.est_monthly_cost_usd.low)} to $
              {usd.format(result.est_monthly_cost_usd.high)}/mo · modeled
            </p>
          </div>
          <ScoreArc value={result.readiness_score} />
        </div>

        <p className="text-sm text-muted-foreground">
          {(["covered", "partial", "risky", "missing"] as const)
            .filter((s) => counts[s])
            .map((s) => `${counts[s]} ${s}`)
            .join(" · ")}
        </p>

        <div className="space-y-3">
          {result.capabilities.map((cap, i) => (
            <CapabilityCard key={`${cap.requirement}-${i}`} capability={cap} />
          ))}
        </div>

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
    </div>
  );
}
