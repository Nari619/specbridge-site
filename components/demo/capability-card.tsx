"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Capability, ReuseDetails } from "@/app/api/analyze/route";

const cardMeta: Record<
  Capability["status"],
  { title: string; dot: string; label: string }
> = {
  covered: { title: "Reuse Card", dot: "bg-brand", label: "text-muted-foreground" },
  partial: {
    title: "Modification Plan",
    dot: "border-[1.5px] border-brand",
    label: "text-muted-foreground",
  },
  risky: {
    title: "Risk Block",
    dot: "bg-amber-500",
    label: "text-amber-600 dark:text-amber-500",
  },
  missing: {
    title: "Build Pack",
    dot: "bg-muted-foreground/40",
    label: "text-muted-foreground",
  },
};

const usd = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function fmtMoney(v: number): string {
  return v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${usd.format(v)}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <pre className="mt-1 overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function CodeSearchButton({ repoPath }: { repoPath: string }) {
  return (
    <span className="group relative inline-block">
      <a
        href={`https://codesearch.meridian.example/search?q=${encodeURIComponent(repoPath)}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors duration-200 ease-out hover:bg-muted"
      >
        Open in code search ↗
      </a>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-56 -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-center text-xs text-background group-hover:block">
        Opens in your company&rsquo;s code search with your own permissions
      </span>
    </span>
  );
}

function ReuseSection({ reuse }: { reuse: ReuseDetails }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Owner">
          <p>{reuse.owner_team ?? "—"}</p>
          {reuse.owner_contact && (
            <a
              href={`mailto:${reuse.owner_contact}`}
              className="text-xs text-brand hover:underline"
            >
              {reuse.owner_contact}
            </a>
          )}
        </Field>
        <Field label="Version">{reuse.version ?? "—"}</Field>
        <Field label="Compliance">
          {reuse.compliance_tags.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {reuse.compliance_tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-amber-600 dark:text-amber-500">no tags</span>
          )}
        </Field>
        <Field label="Cost per call">
          {reuse.est_cost_per_call_usd
            ? `$${reuse.est_cost_per_call_usd.low} to $${reuse.est_cost_per_call_usd.high} · modeled`
            : "—"}
        </Field>
        {reuse.stack && reuse.stack.length > 0 && (
          <Field label="Built with">{reuse.stack.join(", ")}</Field>
        )}
      </div>

      {reuse.input_parameters.length > 0 && (
        <Field label="Input parameters">
          <ul className="mt-1 space-y-1 font-mono text-xs">
            {reuse.input_parameters.map((p) => (
              <li key={p.name} className="text-muted-foreground">
                <span className="text-foreground">{p.name}</span>: {p.type}
                {p.required ? "" : " (optional)"}
              </li>
            ))}
          </ul>
        </Field>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Json label="Example call" value={reuse.example_call} />
        <Json label="Example response" value={reuse.example_response} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {reuse.repo_path && <CodeSearchButton repoPath={reuse.repo_path} />}
        {reuse.docs_url && (
          <a
            href={reuse.docs_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors duration-200 ease-out hover:bg-muted"
          >
            View docs ↗
          </a>
        )}
      </div>
    </div>
  );
}

export function CapabilityCard({ capability }: { capability: Capability }) {
  const [open, setOpen] = useState(false);
  const meta = cardMeta[capability.status];
  const plan = capability.modification_plan;

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 text-left transition-colors duration-200 ease-out hover:bg-muted/40"
      >
        <span className={`size-2 shrink-0 rounded-full ${meta.dot}`} />
        <span
          className={`w-16 shrink-0 text-xs font-medium tracking-wide uppercase ${meta.label}`}
        >
          {capability.status}
        </span>
        <span className="font-medium">{capability.requirement}</span>
        {capability.matched_tool && (
          <span className="font-mono text-xs text-muted-foreground">
            {capability.matched_tool}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {meta.title}
          <span
            className={`inline-block transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          >
            ⌄
          </span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-6 border-t px-5 py-6">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {capability.justification}
              </p>

              {plan && (
                <div className="rounded-xl border border-brand/30 bg-brand/5 p-5">
                  <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
                    Modify, don&rsquo;t rebuild
                  </p>
                  <p className="mt-2 text-lg font-semibold tracking-tight">
                    {plan.modify_effort_days}{" "}
                    {plan.modify_effort_days === 1 ? "day" : "days"} to modify
                    vs {plan.build_new_effort_weeks}{" "}
                    {plan.build_new_effort_weeks === 1 ? "week" : "weeks"} to
                    build,{" "}
                    <span className="text-brand">
                      saves ~{fmtMoney(plan.est_savings_usd)}
                    </span>{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      · modeled
                    </span>
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="What's missing">{plan.whats_missing}</Field>
                    <Field label="Change needed">{plan.change_needed}</Field>
                  </div>
                </div>
              )}

              {capability.risk_block && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
                  <p className="text-xs font-medium tracking-widest text-amber-600 uppercase dark:text-amber-500">
                    Risk block
                  </p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    <Field label="Missing clearance">
                      {capability.risk_block.missing_clearance}
                    </Field>
                    <Field label="Unblock contact">
                      <a
                        href={`mailto:${capability.risk_block.unblock_contact}`}
                        className="text-brand hover:underline"
                      >
                        {capability.risk_block.unblock_contact}
                      </a>
                    </Field>
                    <Field label="Est. unblock time">
                      {capability.risk_block.est_unblock_time} · modeled
                    </Field>
                  </div>
                </div>
              )}

              {capability.reuse && <ReuseSection reuse={capability.reuse} />}

              {capability.build_pack && (
                <div className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-3">
                    <Field label="Build effort">
                      {capability.build_pack.build_effort_weeks}{" "}
                      {capability.build_pack.build_effort_weeks === 1
                        ? "week"
                        : "weeks"}{" "}
                      · modeled
                    </Field>
                    <Field label="Est. run cost">
                      ${usd.format(capability.build_pack.est_monthly_run_cost_usd.low)} to $
                      {usd.format(capability.build_pack.est_monthly_run_cost_usd.high)}
                      /mo · modeled
                    </Field>
                    <Field label="Suggested owner">
                      {capability.build_pack.suggested_owner_team}
                    </Field>
                  </div>

                  {capability.build_pack.nearest_misses.length > 0 && (
                    <Field label="Nearest misses">
                      <ul className="mt-1 space-y-1.5">
                        {capability.build_pack.nearest_misses.map((m) => (
                          <li key={m.tool} className="text-muted-foreground">
                            <span className="font-mono text-xs text-foreground">
                              {m.tool}
                            </span>
                            : {m.reason}
                          </li>
                        ))}
                      </ul>
                    </Field>
                  )}

                  <Json
                    label="Draft MCP spec"
                    value={capability.build_pack.draft_mcp_spec}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
