import { Button } from "@/components/ui/button";
import { ReadinessArc } from "@/components/readiness-arc";

export function Hero() {
  return (
    <section className="flex min-h-screen flex-col items-center justify-center px-6 pt-32 pb-24">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center text-center">
        <h1 className="text-[52px] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-7xl lg:text-[88px]">
          Know what&rsquo;s built.
          <br />
          Before you build.
        </h1>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
          SpecBridge reads your org&rsquo;s tool registry — the structural
          metadata of what&rsquo;s already built — and scores every spec
          against it. No duplicated work, no surprise dependencies.
        </p>
        <div className="mt-10 flex items-center gap-3">
          <Button
            size="lg"
            className="bg-brand px-5 text-white transition-colors duration-200 ease-out hover:bg-brand/90"
            nativeButton={false}
            render={<a href="/demo" />}
          >
            Get started
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="px-5 transition-colors duration-200 ease-out"
            nativeButton={false}
            render={<a href="#how-it-works" />}
          >
            See how it works
          </Button>
        </div>
        <div className="mt-20">
          <ReadinessArc />
        </div>
      </div>
    </section>
  );
}
