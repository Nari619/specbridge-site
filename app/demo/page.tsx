import type { Metadata } from "next";
import { DemoClient } from "@/components/demo/demo-client";
import { PlatformNav } from "@/components/arc/platform-nav";
import { LifecycleBanner } from "@/components/arc/lifecycle-banner";

export const metadata: Metadata = {
  title: "Demo — SpecBridge AI",
  description:
    "Score a PRD against a seeded enterprise tool registry and get a live readiness report.",
};

export default function DemoPage() {
  return (
    <>
      <PlatformNav active="demo" />
      <main className="px-6 pt-36 pb-32">
        <div className="mx-auto max-w-5xl">
          <p className="inline-block rounded-md bg-destructive px-2.5 py-1 text-xs font-medium tracking-widest text-white uppercase">
            Live demo
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            Score a spec against what&rsquo;s already built.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Pick a sample PRD or paste your own. SpecBridge decomposes it into
            capabilities, matches each against an enterprise internal tool
            registry, and returns a readiness verdict.
          </p>
          <div className="mt-8">
            <LifecycleBanner from="demo" />
          </div>
          <div className="mt-12">
            <DemoClient />
          </div>
        </div>
      </main>
    </>
  );
}
