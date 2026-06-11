import { BackgroundBeams } from "@/components/ui/background-beams";
import { FadeIn } from "@/components/fade-in";

export function Vision() {
  return (
    <section className="relative overflow-hidden bg-neutral-950 px-6 py-40 md:py-56">
      <div className="relative z-10 mx-auto max-w-5xl text-center">
        <FadeIn>
          <p className="text-sm font-medium tracking-widest text-neutral-400 uppercase">
            Where this goes
          </p>
          <h2 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance text-white md:text-6xl">
            Every spec, grounded in what your org already knows.
          </h2>
          <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-neutral-400">
            Readiness scores are the start. SpecBridge is becoming the living
            map between product intent and engineering reality — so nothing
            gets built twice, and nothing ships blind.
          </p>
        </FadeIn>
      </div>
      <BackgroundBeams />
    </section>
  );
}
