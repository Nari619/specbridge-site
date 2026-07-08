import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/fade-in";

export function Cta() {
  return (
    <section id="cta" className="px-6 py-32 md:py-44">
      <div className="mx-auto max-w-5xl">
        <FadeIn className="mx-auto max-w-xl text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            See it on your next spec.
          </h2>
          <p className="mx-auto mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
            Paste a PRD into the live demo, and get a readiness verdict, the
            audit trail behind it, and a duplicate-work check, in about 20
            seconds.
          </p>
          <div className="mt-10">
            <Button
              size="lg"
              className="bg-brand px-5 text-white transition-colors duration-200 ease-out hover:bg-brand/90"
              nativeButton={false}
              render={<a href="/demo" />}
            >
              Try the live demo →
            </Button>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            No signup. Runs against a live registry of 100 sample banking tools.
            SpecBridge works with any enterprise tool registry.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
