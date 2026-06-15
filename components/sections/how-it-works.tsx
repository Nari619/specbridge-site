import { FadeIn } from "@/components/fade-in";

const steps = [
  {
    title: "Connect your sources",
    body: "Your MCP tool registry (Kong, JFrog, or internal catalog) plus Confluence and Jira. Metadata only. Never your source code. Security teams clear it in days, not quarters.",
  },
  {
    title: "SpecBridge maps reality",
    body: "A live graph of what's shipped, what's in flight, and what's deprecated, across every team.",
  },
  {
    title: "Write your spec",
    body: "Draft where you already draft. SpecBridge reads along as you type.",
  },
  {
    title: "Get your readiness score",
    body: "Overlaps, gaps, and hidden dependencies, scored 0 to 100, each with an owner attached.",
  },
  {
    title: "Hand off with confidence",
    body: "Engineering starts with answers instead of archaeology.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="px-6 py-32 md:py-44">
      <div className="mx-auto max-w-5xl">
        <FadeIn>
          <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
            How it works
          </p>
          <h2 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            Five steps from guesswork to ground truth.
          </h2>
        </FadeIn>
        <ol className="mt-20">
          {steps.map((step, i) => (
            <li key={step.title} className="border-t last:border-b">
              <FadeIn
                delay={i * 0.06}
                className="grid gap-2 py-10 md:grid-cols-[6rem_16rem_1fr] md:gap-8"
              >
                <span className="font-mono text-sm text-brand">
                  0{i + 1}
                </span>
                <h3 className="text-xl font-medium tracking-tight">
                  {step.title}
                </h3>
                <p className="leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </FadeIn>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
