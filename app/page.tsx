import { Button } from "@/components/ui/button";
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
          <a href="#" className="text-lg font-semibold tracking-tight">
            SpecBridge<span className="text-brand">.</span>
          </a>
          <Button
            variant="outline"
            size="sm"
            className="rounded-md px-3 transition-colors duration-200 ease-out"
            nativeButton={false}
            render={<a href="/demo" />}
          >
            Get started
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
