import { FadeIn } from "@/components/fade-in";

const rows = [
  {
    status: "Built",
    name: "Payment tokenization",
    note: "payments-core already owns this",
  },
  {
    status: "Built",
    name: "Checkout analytics events",
    note: "reusable from web-platform",
  },
  {
    status: "In flight",
    name: "Saved-card UI",
    note: "ships next sprint · PAY-291",
  },
  {
    status: "Gap",
    name: "EU tax calculation",
    note: "no owner found — flag before kickoff",
  },
];

function StatusDot({ status }: { status: string }) {
  if (status === "Built")
    return <span className="size-2 rounded-full bg-brand" />;
  if (status === "In flight")
    return <span className="size-2 rounded-full border-[1.5px] border-brand" />;
  return <span className="size-2 rounded-full bg-muted-foreground/40" />;
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
            One score. Every blind spot, before kickoff.
          </h2>
        </FadeIn>
        <FadeIn delay={0.1} className="mt-16">
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex items-center gap-1.5 border-b px-5 py-3.5">
              <span className="size-2.5 rounded-full bg-muted-foreground/20" />
              <span className="size-2.5 rounded-full bg-muted-foreground/20" />
              <span className="size-2.5 rounded-full bg-muted-foreground/20" />
              <span className="ml-3 text-xs text-muted-foreground">
                specbridge.ai/reports/checkout-v2
              </span>
            </div>
            <div className="p-6 md:p-10">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Checkout v2 — readiness
                  </p>
                  <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">
                    68<span className="text-brand">%</span>
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  2 reusable · 1 in flight · 1 gap
                </p>
              </div>
              <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full w-[68%] rounded-full bg-brand" />
              </div>
              <ul className="mt-8 divide-y">
                {rows.map((row) => (
                  <li
                    key={row.name}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 py-4"
                  >
                    <StatusDot status={row.status} />
                    <span className="w-16 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {row.status}
                    </span>
                    <span className="font-medium">{row.name}</span>
                    <span className="ml-auto text-sm text-muted-foreground">
                      {row.note}
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
