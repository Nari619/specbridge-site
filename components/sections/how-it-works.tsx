import { FadeIn } from "@/components/fade-in";

const steps = [
  {
    title: "Paste your PRD",
    body: "Drop in a spec. No integration needed for the demo — it runs against a seeded 100-tool banking registry.",
  },
  {
    title: "Decompose and match",
    body: "SpecBridge breaks the PRD into atomic capabilities and matches each against the registry: covered, needs modification, or missing.",
  },
  {
    title: "The compliance gate runs in code",
    body: "For every match, deterministic code — not the model — reads the tool's compliance tags and flags what's risky. You can read the rule.",
  },
  {
    title: "Get a verdict, a score, and the reasoning",
    body: "GO or NO-GO, a 0-to-100 readiness score, and a “How SpecBridge decided” audit trail showing which tag triggered which flag.",
  },
  {
    title: "And a duplicate-work alert",
    body: "If another team already scoped an overlapping PRD, SpecBridge flags it — with the specific capabilities you'd both be building.",
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
            From a pasted spec to a decision you can audit.
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
