import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/fade-in";

const included = [
  "Unlimited readiness reports",
  "Three source integrations",
  "Up to five teammates",
];

export function Cta() {
  return (
    <section id="cta" className="px-6 py-32 md:py-44">
      <div className="mx-auto max-w-5xl">
        <FadeIn className="mx-auto max-w-md text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            Start with one spec.
          </h2>
          <div className="mt-12 rounded-3xl border bg-card p-10 text-left shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">
              First project
            </p>
            <p className="mt-2 text-5xl font-semibold tracking-tight">
              $0
              <span className="ml-2 text-base font-normal text-muted-foreground">
                forever
              </span>
            </p>
            <ul className="mt-8 space-y-3">
              {included.map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm">
                  <span className="size-1.5 rounded-full bg-brand" />
                  {item}
                </li>
              ))}
            </ul>
            <Button
              size="lg"
              className="mt-10 w-full bg-brand px-5 text-white transition-colors duration-200 ease-out hover:bg-brand/90"
              nativeButton={false}
              render={<a href="/demo" />}
            >
              Get started
            </Button>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              No credit card required. Demo runs against a live registry of 100
              sample banking tools — SpecBridge works with any enterprise tool
              registry.
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
