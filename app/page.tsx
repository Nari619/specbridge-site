import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/logo-mark";
import { Hero } from "@/components/sections/hero";
import { Problem } from "@/components/sections/problem";
import { HowItWorks } from "@/components/sections/how-it-works";
import { Report } from "@/components/sections/report";
import { Vision } from "@/components/sections/vision";
import { Cta } from "@/components/sections/cta";

export default function Home() {
  return (
    <>
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
          <a
            href="#"
            className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <LogoMark className="size-[22px]" />
            <span>
              SpecBridge<span className="text-brand">.</span>
            </span>
          </a>
          <Button
            size="sm"
            className="rounded-md bg-brand px-3.5 text-white transition-colors duration-200 ease-out hover:bg-brand/90"
            nativeButton={false}
            render={<a href="/demo" />}
          >
            Try the live demo →
          </Button>
        </div>
      </header>
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Report />
        <Vision />
        <Cta />
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground">
          <p>© 2026 SpecBridge AI</p>
          <p>Built for product managers who ship.</p>
        </div>
      </footer>
    </>
  );
}
