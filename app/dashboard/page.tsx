import type { Metadata } from "next";
import Link from "next/link";
import { PlatformNav } from "@/components/arc/platform-nav";
import { getAnalysesOverview } from "@/lib/analyses-source";
import type { AnalysisListItem } from "@/lib/analyses-source";

export const metadata: Metadata = {
  title: "Dashboard: SpecBridge AI",
  description: "Every analysis SpecBridge has scored, in one view.",
};

// Always reflect the latest saved analyses.
export const dynamic = "force-dynamic";

const usd = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${accent ?? ""}`}
      >
        {value}
      </p>
    </div>
  );
}

const countMeta: { key: keyof AnalysisListItem; label: string; dot: string }[] =
  [
    { key: "covered_count", label: "covered", dot: "bg-brand" },
    { key: "partial_count", label: "partial", dot: "border-[1.5px] border-brand" },
    { key: "risky_count", label: "risky", dot: "bg-amber-500" },
    { key: "missing_count", label: "missing", dot: "bg-muted-foreground/40" },
  ];

function CountChips({ row }: { row: AnalysisListItem }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
      {countMeta.map((m) => (
        <span key={m.label} className="inline-flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${m.dot}`} />
          {row[m.key] ?? 0} {m.label}
        </span>
      ))}
    </span>
  );
}

export default async function DashboardPage() {
  const { ok, summary, recent } = await getAnalysesOverview();

  return (
    <>
      <PlatformNav active="dashboard" />
      <main className="px-6 pt-36 pb-32">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
            Memory
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            Every analysis, one view.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            A running memory of every spec SpecBridge has scored: savings found,
            risk caught, and the verdict it reached.
          </p>

          {!ok && (
            <p className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-500">
              Couldn&rsquo;t reach the analyses store right now. Showing what we
              have.
            </p>
          )}

          {summary.total === 0 ? (
            <div className="mt-12 rounded-2xl border bg-card p-12 text-center shadow-sm">
              <p className="text-lg font-medium">No analyses yet.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Run one on the{" "}
                <Link href="/demo" className="text-brand hover:underline">
                  demo
                </Link>{" "}
                and it will show up here.
              </p>
            </div>
          ) : (
            <>
              {/* Summary stats */}
              <div className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-5">
                <Stat label="Analyses run" value={usd.format(summary.total)} />
                <Stat
                  label="Avg readiness"
                  value={
                    summary.avgScore !== null ? `${summary.avgScore}%` : "—"
                  }
                  accent="text-brand"
                />
                <Stat
                  label="Est. savings"
                  value={`$${usd.format(summary.totalSavings)}`}
                  accent="text-[#4fb286]"
                />
                <Stat
                  label="Risky flags"
                  value={usd.format(summary.totalRisky)}
                  accent="text-amber-600 dark:text-amber-500"
                />
                <Stat
                  label="GO / NO-GO"
                  value={
                    <>
                      <span className="text-brand">{summary.goCount}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-amber-600 dark:text-amber-500">
                        {summary.nogoCount}
                      </span>
                    </>
                  }
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Across all saved analyses. Savings are modeled.
              </p>

              {/* Recent analyses */}
              <section className="mt-16">
                <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                  Recent analyses
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Most recent first. Click any to re-open the full report.
                </p>
                <div className="mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm">
                  <ul className="divide-y">
                    {recent.map((row) => {
                      const isGo = String(row.verdict).toUpperCase() === "GO";
                      return (
                        <li key={row.id}>
                          <Link
                            href={`/dashboard/${row.id}`}
                            className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 transition-colors duration-200 ease-out hover:bg-muted/40"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {row.prd_title || "Untitled analysis"}
                              </span>
                              <span className="mt-1 block">
                                <CountChips row={row} />
                              </span>
                            </span>
                            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                              {row.readiness_score ?? "—"}%
                            </span>
                            <span
                              className={`w-16 shrink-0 text-sm font-medium ${
                                isGo
                                  ? "text-brand"
                                  : "text-amber-600 dark:text-amber-500"
                              }`}
                            >
                              {row.verdict ?? "—"}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {fmtDate(row.created_at)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </>
  );
}
