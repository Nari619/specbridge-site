import { FadeIn } from "@/components/fade-in";
import { NumberTicker } from "@/components/ui/number-ticker";

export function Problem() {
  return (
    <section className="px-6 py-32 md:py-44">
      <div className="mx-auto max-w-5xl">
        <FadeIn>
          <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
            The problem
          </p>
          <p className="mt-6 text-8xl font-semibold tracking-tight text-brand md:text-9xl">
            <NumberTicker
              value={40}
              className="text-current dark:text-current"
            />
            %
          </p>
          <p className="mt-6 max-w-2xl text-3xl leading-snug font-medium tracking-tight text-balance md:text-4xl">
            Industry estimates put up to 40% of engineering effort into
            rebuilding things the org already has.
          </p>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Not because engineers want to, because nobody could see it at spec
            time. The capability already existed in another team&rsquo;s
            registry. Or another team was scoping the very same thing that week.
            SpecBridge makes it visible before anyone writes code.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
