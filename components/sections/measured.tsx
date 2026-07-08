import { FadeIn } from "@/components/fade-in";

// All numbers are from the committed eval baseline (8 hand-labeled banking PRDs,
// 5-run distribution). See eval/README.md. The unflattering precision number is
// shown on purpose — a "measured" section that hides its weakest metric isn't
// measuring.
const stats = [
  { value: "88%", label: "compliance-gate accuracy" },
  { value: "95%", label: "capability recall" },
  { value: "68%", label: "tool-match precision" },
];

const REPO_EVAL_README =
  "https://github.com/Nari619/specbridge-site/blob/main/eval/README.md";

export function Measured() {
  return (
    <section className="px-6 py-32 md:py-44">
      <div className="mx-auto max-w-5xl">
        <FadeIn>
          <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
            Measured, not claimed
          </p>
          <h2 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            We grade our own homework, and publish the numbers.
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            SpecBridge ships with an eval harness: 8 hand-labeled banking PRDs,
            each scored five times for a stable distribution.
          </p>
        </FadeIn>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {stats.map((s, i) => (
            <FadeIn key={s.label} delay={i * 0.08}>
              <div className="rounded-2xl border bg-card p-8 shadow-sm">
                <p className="text-5xl font-semibold tracking-tight tabular-nums text-brand">
                  {s.value}
                </p>
                <p className="mt-3 text-sm text-muted-foreground">{s.label}</p>
              </div>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={0.1}>
          <p className="mt-12 max-w-2xl text-lg leading-relaxed">
            We even built an agentic orchestrator to beat this engine. It
            improved precision and cut cost, but it couldn&rsquo;t match the
            deterministic compliance gate, so we didn&rsquo;t ship it.{" "}
            <span className="font-medium">The measurement is the product.</span>
          </p>
          <p className="mt-6 text-sm text-muted-foreground">
            Numbers are from our own eval set, not customer outcomes.{" "}
            <a
              href={REPO_EVAL_README}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline"
            >
              Verify them in the repo →
            </a>
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
