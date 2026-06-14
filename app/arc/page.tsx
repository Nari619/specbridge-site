import type { Metadata } from "next";
import {
  contracts,
  simulateFleet,
  simulateFleetFresh,
  SIM_START,
  SIM_END,
} from "@/lib/arc-simulator";
import { runPolicy, verifyDeterminism } from "@/lib/arc-policy";
import { computeEconomics } from "@/lib/arc-economics";
import { computeVariance } from "@/lib/arc-variance";
import { PlatformNav } from "@/components/arc/platform-nav";
import { LifecycleBanner } from "@/components/arc/lifecycle-banner";
import {
  verdictStyle,
  interventionStyle,
  GOLD_TEXT,
  CYAN_TEXT,
} from "@/components/arc/status-styles";

export const metadata: Metadata = {
  title: "ARC — runtime governance · SpecBridge",
  description:
    "ARC is the runtime layer. SpecBridge estimates; ARC measures what your agents actually cost and governs them against their contracts.",
};

const usd = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function fmtClock(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").replace(".000Z", "Z");
}

function trendArrow(trendPct: number | null): string {
  if (trendPct === null) return "—";
  if (trendPct > 10) return `↑ +${trendPct.toFixed(1)}%`;
  if (trendPct < -10) return `↓ ${trendPct.toFixed(1)}%`;
  return `→ ${trendPct >= 0 ? "+" : ""}${trendPct.toFixed(1)}%`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
      {children}
    </p>
  );
}

export default function ArcPage() {
  const sessions = simulateFleet();
  const policy = runPolicy(sessions, contracts);
  const economics = computeEconomics(
    sessions,
    contracts,
    SIM_START + 24 * 3600_000,
  );
  const variance = computeVariance(sessions, contracts, economics);
  // Determinism assertion: full pipeline twice, must hash identically.
  const determinism = verifyDeterminism(simulateFleetFresh, contracts);

  const totalSaved = policy.totals.reduce((s, t) => s + t.saved_usd, 0);
  const econByAgent = new Map(economics.map((e) => [e.agent_name, e]));

  return (
    <>
      <PlatformNav active="arc" />
      <main className="px-6 pt-36 pb-32">
        <div className="mx-auto max-w-5xl">
          {/* Intro */}
          <SectionLabel>Live runtime</SectionLabel>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            Govern what your agents actually cost.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            ARC — the runtime layer.{" "}
            <span className="text-foreground">SpecBridge estimates; ARC measures.</span>{" "}
            It replays a 48-hour agent fleet against its cost contracts, enforces
            every threshold, and feeds the actuals back to correct the next
            estimate.
          </p>

          {/* Fleet stat band */}
          <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Sessions" value={usd.format(sessions.length)} />
            <Stat
              label="Interventions"
              value={usd.format(policy.interventions.length)}
            />
            <Stat
              label="Saved by stops"
              value={`$${usd.format(totalSaved)}`}
            />
            <Stat label="Agents" value={String(contracts.length)} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href="/arc/evidence"
              className="inline-flex items-center rounded-md bg-brand px-5 py-2 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-brand/90"
            >
              Generate Evidence Pack →
            </a>
            <p className="text-xs text-muted-foreground">
              Determinism: PASS · two fresh runs hashed{" "}
              <span className="font-mono">{determinism.hash}</span> ·{" "}
              {determinism.interventionCount} interventions · all derived figures
              modeled
            </p>
          </div>

          <div className="mt-8">
            <LifecycleBanner from="arc" />
          </div>

          {/* Closed Loop */}
          <section className="mt-20">
            <SectionLabel>Closed loop</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
              SpecBridge estimate vs ARC actual
            </h2>
            <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">
              Design-time per-task estimates measured against the cost-per-action
              ARC observed at runtime.{" "}
              <span className={GOLD_TEXT}>Gold is the estimate</span>,{" "}
              <span className={CYAN_TEXT}>cyan is the actual</span>. All figures
              modeled.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {variance.map((v) => {
                const material = v.ratio !== null && v.ratio >= 1.5;
                return (
                  <div
                    key={v.agent_name}
                    className={`rounded-2xl border bg-card p-5 shadow-sm ${material ? "border-amber-500/50" : ""}`}
                  >
                    <p className="font-mono text-sm font-medium">
                      {v.agent_name}
                    </p>
                    <div className="mt-4 flex items-end gap-5">
                      <div>
                        <p
                          className={`text-[10px] font-medium tracking-widest uppercase ${GOLD_TEXT}`}
                        >
                          Estimated
                        </p>
                        <p
                          className={`mt-0.5 text-2xl font-semibold tracking-tight tabular-nums ${GOLD_TEXT}`}
                        >
                          ${v.estimate_usd.toFixed(2)}
                        </p>
                      </div>
                      <span className="pb-1.5 text-muted-foreground">→</span>
                      <div>
                        <p
                          className={`text-[10px] font-medium tracking-widest uppercase ${CYAN_TEXT}`}
                        >
                          Actual
                        </p>
                        <p
                          className={`mt-0.5 text-2xl font-semibold tracking-tight tabular-nums ${CYAN_TEXT}`}
                        >
                          {v.actual_cpa_usd !== null
                            ? `$${v.actual_cpa_usd.toFixed(2)}`
                            : "—"}
                        </p>
                      </div>
                    </div>
                    <p className="mt-4 text-sm">
                      <span className="text-muted-foreground">Variance: </span>
                      {v.variance_pct !== null ? (
                        <span
                          className={
                            v.direction === "over"
                              ? "font-medium text-amber-600 dark:text-amber-500"
                              : "font-medium"
                          }
                        >
                          {v.variance_pct >= 0 ? "+" : ""}
                          {v.variance_pct.toFixed(0)}%
                          {v.ratio !== null ? ` · ${v.ratio.toFixed(1)}x` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {v.cause}
                    </p>
                    {v.next_estimate_should_assume && (
                      <p className="mt-4 rounded-lg border-l-2 border-brand bg-brand/5 py-2 pr-2 pl-3 text-sm text-brand">
                        {v.next_estimate_should_assume}
                      </p>
                    )}
                    {v.agent_name === "refund-processing" && (
                      <a
                        href="/demo"
                        className="mt-4 block border-t pt-3 text-sm font-medium text-brand hover:underline"
                      >
                        Design-time estimate from SpecBridge: $
                        {v.estimate_usd.toFixed(2)}/task →
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Fleet economics */}
          <section className="mt-20">
            <SectionLabel>Fleet economics</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
              Cost, return, and verdict per agent
            </h2>
            <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">
              Cost-per-action, ROI-per-run, and day-over-day trend. Agents with
              uninstrumented value are reported honestly as UNMEASURED — no
              return is guessed. All figures modeled.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {economics.map((e) => {
                const t = policy.totals.find(
                  (x) => x.agent_name === e.agent_name,
                );
                const ivCount = t ? t.warns + t.throttles + t.stops : 0;
                const style = verdictStyle[e.verdict];
                return (
                  <div
                    key={e.agent_name}
                    className="rounded-2xl border bg-card p-5 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-sm font-medium">
                        {e.agent_name}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.chipBorder} ${style.text}`}
                      >
                        <span className={`size-1.5 rounded-full ${style.dot}`} />
                        {e.verdict}
                      </span>
                    </div>
                    <dl className="mt-4 space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">CPA</dt>
                        <dd className="tabular-nums">
                          {e.cpa_usd !== null ? `$${e.cpa_usd.toFixed(3)}` : "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">ROI-per-run</dt>
                        <dd className="tabular-nums">
                          {e.roi_per_run !== null
                            ? `${e.roi_per_run.toFixed(1)}x`
                            : "— value unknown"}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">CPA trend</dt>
                        <dd className="tabular-nums">
                          {trendArrow(e.cpa_trend_pct)}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Interventions</dt>
                        <dd className="tabular-nums">{ivCount}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Saved by stops</dt>
                        <dd className="tabular-nums">
                          ${(t?.saved_usd ?? 0).toFixed(2)}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-4 border-t pt-3 text-sm leading-relaxed text-muted-foreground">
                      {e.verdict_note}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Governance summary */}
          <section className="mt-20">
            <SectionLabel>Governance</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
              Enforcement summary
            </h2>
            <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">
              Per-agent contract enforcement over the window — raw vs governed
              spend, and what each control prevented. Savings modeled.
            </p>
            <div className="mt-8 overflow-x-auto rounded-2xl border bg-card shadow-sm">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs tracking-widest text-muted-foreground uppercase">
                    <th className="px-4 py-3 font-medium">Agent</th>
                    <th className="px-4 py-3 font-medium">Sessions</th>
                    <th className="px-4 py-3 font-medium">Raw</th>
                    <th className="px-4 py-3 font-medium">Governed</th>
                    <th className="px-4 py-3 font-medium">Saved</th>
                    <th className="px-4 py-3 font-medium">Warn</th>
                    <th className="px-4 py-3 font-medium">Throttle</th>
                    <th className="px-4 py-3 font-medium">Stop</th>
                  </tr>
                </thead>
                <tbody>
                  {policy.totals.map((t) => {
                    const verdict = econByAgent.get(t.agent_name)?.verdict;
                    return (
                      <tr key={t.agent_name} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          <span className="font-mono">{t.agent_name}</span>
                          {verdict && (
                            <span
                              className={`ml-2 inline-block size-1.5 rounded-full align-middle ${verdictStyle[verdict].dot}`}
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{t.sessions}</td>
                        <td className="px-4 py-3 tabular-nums">
                          ${t.raw_cost_usd.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          ${t.spent_usd.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 tabular-nums font-medium">
                          ${t.saved_usd.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{t.warns}</td>
                        <td className="px-4 py-3 tabular-nums">{t.throttles}</td>
                        <td className="px-4 py-3 tabular-nums">{t.stops}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Intervention log */}
          <section className="mt-20">
            <SectionLabel>Intervention log</SectionLabel>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
              Every action, in order ({policy.interventions.length})
            </h2>
            <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">
              The chronological enforcement trail. The full version, with the
              exact rule text that fired on each, is in the Evidence Pack.
            </p>
            <div className="mt-8 max-h-[28rem] overflow-y-auto rounded-2xl border bg-card shadow-sm">
              <ul className="divide-y">
                {policy.interventions.map((iv) => {
                  const style = interventionStyle[iv.type];
                  return (
                    <li key={iv.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span className={`size-2 rounded-full ${style.dot}`} />
                        <span
                          className={`w-16 text-xs font-medium tracking-wide uppercase ${style.text}`}
                        >
                          {iv.type}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {fmtClock(iv.timestamp)}
                        </span>
                        <span className="font-mono text-xs">
                          {iv.agent_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {iv.scope} · {iv.threshold_pct}%
                        </span>
                      </div>
                      <p className="mt-1 pl-5 text-sm leading-relaxed text-muted-foreground">
                        {iv.reason}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </div>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground">
          <p>© 2026 SpecBridge AI · ARC runtime governance</p>
          <p>
            Seeded {fmtClock(new Date(SIM_START).toISOString())} →{" "}
            {fmtClock(new Date(SIM_END).toISOString())} · identical every run
          </p>
        </div>
      </footer>
    </>
  );
}
