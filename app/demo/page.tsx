import type { Metadata } from "next";
import Link from "next/link";
import { DemoClient } from "@/components/demo/demo-client";

export const metadata: Metadata = {
  title: "Demo — SpecBridge AI",
  description:
    "Score a PRD against a seeded banking tool registry and get a live readiness report.",
};

export default function DemoPage() {
  return (
    <>
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            SpecBridge<span className="text-brand">.</span>
          </Link>
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to site
          </Link>
        </div>
      </header>
      <main className="px-6 pt-36 pb-32">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
            Live demo
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            Score a spec against what&rsquo;s already built.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Pick a sample PRD or paste your own. SpecBridge decomposes it into
            capabilities, matches each against a bank&rsquo;s internal tool
            registry, and returns a readiness verdict.
          </p>
          <div className="mt-12">
            <DemoClient />
          </div>
        </div>
      </main>
    </>
  );
}
