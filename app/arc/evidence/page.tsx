import type { Metadata } from "next";
import Link from "next/link";
import { contracts, simulateFleet, SIM_START, SIM_END } from "@/lib/arc-simulator";
import { runPolicy } from "@/lib/arc-policy";
import { computeEconomics } from "@/lib/arc-economics";
import { PrintButton } from "@/components/arc/print-button";

export const metadata: Metadata = {
  title: "Operational Evidence Report — Agent Cost Governance",
};

const ORG_NAME = "Meridian Bank, N.A.";

// Control-theme glossary: maps each tag to the operational control it
// references. Deliberately framed as themes, not certified mappings.
const TAG_THEMES: Record<string, string> = {
  "gdpr-art-22": "human escalation on automated decisions",
  "audit-grade": "immutable audit logging of actions and interventions",
  "sar-workflow": "investigator-in-the-loop continuity",
  "pii-handling": "controlled handling of personal data",
};

function fmtTs(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function fmtUsd(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function EvidencePage() {
  const sessions = simulateFleet();
  const policy = runPolicy(sessions, contracts);
  const economics = computeEconomics(
    sessions,
    contracts,
    SIM_START + 24 * 3600_000,
  );

  // Deterministic generation stamp: the report is reproducible byte-for-byte
  // from the seeded dataset, so it is stamped at the close of the window.
  const generatedAt = new Date(SIM_END).toISOString();
  const totalSaved = policy.totals.reduce((s, t) => s + t.saved_usd, 0);
  const totalInterventions = policy.interventions.length;

  return (
    <main className="mx-auto max-w-3xl bg-white px-8 py-12 font-serif text-[13px] leading-relaxed text-neutral-900">
      <div className="no-print mb-8 flex items-center justify-between">
        <Link href="/arc" className="text-sm text-neutral-500 hover:underline">
          ← Back to ARC console
        </Link>
        <PrintButton />
      </div>

      {/* Document header */}
      <header className="border-b-2 border-neutral-900 pb-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-neutral-500 uppercase">
          {ORG_NAME}
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Operational Evidence Report — Agent Cost Governance
        </h1>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-neutral-600">
          <dt className="font-semibold">Reporting period</dt>
          <dd>
            {fmtTs(new Date(SIM_START).toISOString())} —{" "}
            {fmtTs(new Date(SIM_END).toISOString())} (48 hours)
          </dd>
          <dt className="font-semibold">Generated</dt>
          <dd>{fmtTs(generatedAt)}</dd>
          <dt className="font-semibold">Source</dt>
          <dd>
            ARC runtime governance layer · deterministic replay (
            {sessions.length} sessions, {totalInterventions} interventions)
          </dd>
        </dl>
      </header>

      {/* Section 1 — Governance framework */}
      <section className="evidence-section mt-10">
        <h2 className="text-base font-bold">
          1. Governance Framework
        </h2>
        <p className="mt-2 text-neutral-700">
          The following cost-governance contracts were active for every agent
          fleet during the reporting period. Each contract defines per-task and
          per-fleet spend controls and an escalation rule. The regulatory tags
          reference the control <em>themes</em> each contract supports.
        </p>
        {contracts.map((c) => (
          <div
            key={c.agent_name}
            className="evidence-entry mt-5 border-l-2 border-neutral-300 pl-4"
          >
            <h3 className="font-bold">{c.agent_name}</h3>
            <p className="text-neutral-700">{c.task_type}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-neutral-700">
              <dt className="font-semibold">Per-task cap</dt>
              <dd>{fmtUsd(c.max_cost_per_task_usd)} per task</dd>
              <dt className="font-semibold">Daily fleet ceiling</dt>
              <dd>{fmtUsd(c.daily_fleet_ceiling_usd)} per UTC day</dd>
              <dt className="font-semibold">Escalation rule</dt>
              <dd>{c.escalation_rule}</dd>
              <dt className="font-semibold">Control themes</dt>
              <dd>
                {c.regulatory_tags.map((tag) => (
                  <span key={tag} className="block">
                    <span className="font-mono text-xs">{tag}</span>
                    {TAG_THEMES[tag] ? ` — ${TAG_THEMES[tag]}` : ""}
                  </span>
                ))}
              </dd>
            </dl>
          </div>
        ))}
      </section>

      {/* Section 2 — Intervention log */}
      <section className="evidence-section mt-10">
        <h2 className="text-base font-bold">2. Intervention Log</h2>
        <p className="mt-2 text-neutral-700">
          Every automated intervention during the reporting period, in
          chronological order. Each entry records the threshold crossed, the
          action taken, and the exact contract rule that fired.
        </p>
        <ol className="mt-4 space-y-3">
          {policy.interventions.map((iv, i) => (
            <li
              key={iv.id}
              className="evidence-entry border-b border-neutral-200 pb-3"
            >
              <p className="font-semibold">
                {String(i + 1).padStart(3, "0")}. {fmtTs(iv.timestamp)} —{" "}
                {iv.type.toUpperCase()} ({iv.scope}, {iv.threshold_pct}%
                threshold)
              </p>
              <p className="text-neutral-700">
                Agent: <span className="font-mono">{iv.agent_name}</span> ·
                Session: <span className="font-mono">{iv.session_id}</span> ·
                Contract: <span className="font-mono">{iv.contract_ref}</span>
              </p>
              <p className="text-neutral-700">{iv.reason}</p>
              <p className="mt-1 text-xs text-neutral-500 italic">
                Rule fired: {iv.rule_text}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Section 3 — Outcomes */}
      <section className="evidence-section mt-10">
        <h2 className="text-base font-bold">3. Outcomes</h2>
        <p className="mt-2 text-neutral-700">
          Per-agent economics over the reporting period. Cost-per-action (CPA),
          return-per-run, and enforcement savings are{" "}
          <span className="font-semibold">modeled</span> estimates derived from
          observed telemetry and the counterfactual cost avoided by stop
          interventions.
        </p>
        <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[440px] border-collapse text-xs">
          <thead>
            <tr className="border-b-2 border-neutral-900 text-left">
              <th className="py-1 pr-3">Agent</th>
              <th className="py-1 pr-3">Verdict</th>
              <th className="py-1 pr-3">CPA</th>
              <th className="py-1 pr-3">ROI/run</th>
              <th className="py-1 pr-3">Interventions</th>
              <th className="py-1">Saved by stops</th>
            </tr>
          </thead>
          <tbody>
            {economics.map((e) => {
              const t = policy.totals.find((x) => x.agent_name === e.agent_name);
              const ivCount = t ? t.warns + t.throttles + t.stops : 0;
              return (
                <tr key={e.agent_name} className="border-b border-neutral-200">
                  <td className="py-1.5 pr-3 font-mono">{e.agent_name}</td>
                  <td className="py-1.5 pr-3">{e.verdict}</td>
                  <td className="py-1.5 pr-3">
                    {e.cpa_usd !== null ? fmtUsd(e.cpa_usd) : "—"}
                  </td>
                  <td className="py-1.5 pr-3">
                    {e.roi_per_run !== null ? `${e.roi_per_run.toFixed(1)}x` : "—"}
                  </td>
                  <td className="py-1.5 pr-3">{ivCount}</td>
                  <td className="py-1.5">{fmtUsd(t?.saved_usd ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-900 font-semibold">
              <td className="py-1.5 pr-3" colSpan={4}>
                Total enforcement savings (modeled)
              </td>
              <td className="py-1.5 pr-3">{totalInterventions}</td>
              <td className="py-1.5">{fmtUsd(totalSaved)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Agents with uninstrumented business value are reported as UNMEASURED;
          no return is computed or estimated for them.
        </p>
      </section>

      {/* Section 4 — Scope & limitations */}
      <section className="evidence-section mt-10">
        <h2 className="text-base font-bold">4. Scope &amp; Limitations</h2>
        <div className="mt-2 space-y-3 text-neutral-700">
          <p>
            This report documents the operational cost-governance controls that
            ARC applied to autonomous agent activity during the reporting
            period, and the interventions those controls produced. It is
            intended as evidence of controls that supports an organization&rsquo;s
            compliance posture and internal audit process.
          </p>
          <p>
            This report does not by itself constitute regulatory compliance, and
            it does not certify conformance with any specific regulation. The
            control themes referenced in Section 1 (for example, human
            escalation on automated decisions, or audit logging) describe the{" "}
            <em>intent</em> of each control. They are not certified mappings to
            statutory or regulatory requirements; establishing such mappings is
            the responsibility of the organization and its advisors.
          </p>
          <p>
            Cost, savings, return, and counterfactual figures throughout this
            report are <span className="font-semibold">modeled</span> estimates
            derived from observed telemetry. Enforcement savings represent cost
            that the governance layer prevented from being incurred, estimated
            against the observed spend trajectory; they are not realized
            accounting figures.
          </p>
          <p>
            The underlying telemetry and intervention log are reproducible:
            re-running the governance engine over the same input produces a
            byte-identical report.
          </p>
        </div>
      </section>

      <footer className="mt-10 border-t border-neutral-300 pt-4 text-xs text-neutral-500">
        <p>
          {ORG_NAME} · Operational Evidence Report · generated by ARC runtime
          governance · page generated {fmtTs(generatedAt)}
        </p>
      </footer>
    </main>
  );
}
