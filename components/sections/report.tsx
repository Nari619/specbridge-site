import { FadeIn } from "@/components/fade-in";

// Faithful static mock of what /demo actually renders — same status vocabulary
// (covered / partial / risky / missing), the twin-catcher callout, the
// deterministic-gate strip, and a verdict + score. Numbers are internally
// consistent: covered=1, partial=0.5, risky=0.35, missing=0 →
// (2×1 + 1×0.5 + 2×0.35 + 1×0) / 6 = 53.
const rows = [
  { status: "covered", name: "Verify applicant identity (KYC)", tool: "kyc_verification_service" },
  { status: "covered", name: "Screen against AML & sanctions lists", tool: "aml_screening_api" },
  { status: "partial", name: "Risk-based personalized pricing", tool: "interest_rate_service" },
  { status: "risky", name: "Pull credit report from bureau", tool: "credit_bureau_pull" },
  { status: "risky", name: "Retrieve customer profile", tool: "customer_profile_lookup" },
  { status: "missing", name: "Generate adverse-action notices", tool: "no tool in registry" },
];

function StatusDot({ status }: { status: string }) {
  if (status === "covered")
    return <span className="size-2 shrink-0 rounded-full bg-brand" />;
  if (status === "partial")
    return <span className="size-2 shrink-0 rounded-full border-[1.5px] border-brand" />;
  if (status === "risky")
    return <span className="size-2 shrink-0 rounded-full bg-amber-500" />;
  return <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />;
}

export function Report() {
  return (
    <section className="px-6 py-32 md:py-44">
      <div className="mx-auto max-w-5xl">
        <FadeIn>
          <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
            The readiness report
          </p>
          <h2 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            The report a PM actually gets.
          </h2>
        </FadeIn>
        <FadeIn delay={0.1} className="mt-16">
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center gap-1.5 border-b px-5 py-3.5">
              <span className="size-2.5 rounded-full bg-muted-foreground/20" />
              <span className="size-2.5 rounded-full bg-muted-foreground/20" />
              <span className="size-2.5 rounded-full bg-muted-foreground/20" />
              <span className="ml-3 text-xs text-muted-foreground">
                specbridge.ai/demo
              </span>
            </div>
            <div className="space-y-6 p-6 md:p-10">
              {/* Twin-catcher callout */}
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
                <p className="text-sm font-semibold tracking-tight text-amber-700 dark:text-amber-500">
                  Similar PRD detected — you may be duplicating work
                </p>
                <p className="mt-1.5 text-sm">
                  <span className="font-medium">Real-Time Card Fraud</span>{" "}
                  <span className="text-muted-foreground">
                    was analyzed 3 days ago · 95% similar · 7 overlapping
                    capabilities
                  </span>
                </p>
              </div>

              {/* Verdict + score */}
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Readiness report</p>
                  <p className="mt-1 text-5xl font-semibold tracking-tight text-amber-600 dark:text-amber-500">
                    NO-GO
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    2 covered · 1 partial · 2 risky · 1 missing
                  </p>
                </div>
                <p className="text-5xl font-semibold tracking-tight tabular-nums">
                  53<span className="text-brand">%</span>
                </p>
              </div>

              {/* Deterministic-gate strip */}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                <p className="text-xs font-medium tracking-widest text-amber-700 uppercase dark:text-amber-500">
                  How SpecBridge decided — 2 RISKY flags set by code
                </p>
                <p className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground">
                  <span className="text-foreground">credit_bureau_pull</span> →
                  tags [none] · requires [pii-cleared, audit-grade] → RISKY
                </p>
              </div>

              {/* Capability rows */}
              <ul className="divide-y">
                {rows.map((row) => (
                  <li
                    key={row.name}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-4"
                  >
                    <StatusDot status={row.status} />
                    <span
                      className={`w-16 text-xs font-medium tracking-wide uppercase ${
                        row.status === "risky"
                          ? "text-amber-600 dark:text-amber-500"
                          : "text-muted-foreground"
                      }`}
                    >
                      {row.status}
                    </span>
                    <span className="font-medium">{row.name}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {row.tool}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
