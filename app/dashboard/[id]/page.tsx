import type { Metadata } from "next";
import Link from "next/link";
import { PlatformNav } from "@/components/arc/platform-nav";
import { SavedReport } from "@/components/dashboard/saved-report";
import { getAnalysisById } from "@/lib/analyses-source";

export const metadata: Metadata = {
  title: "Saved analysis: SpecBridge AI",
};

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SavedAnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAnalysisById(id);

  return (
    <>
      <PlatformNav active="dashboard" />
      <main className="px-6 pt-36 pb-32">
        <div className="mx-auto max-w-5xl">
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground"
          >
            ← Back to dashboard
          </Link>

          {!detail ? (
            <div className="mt-12 rounded-2xl border bg-card p-12 text-center shadow-sm">
              <p className="text-lg font-medium">Analysis not found.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                It may have been removed, or the link is wrong. Head back to the{" "}
                <Link href="/dashboard" className="text-brand hover:underline">
                  dashboard
                </Link>
                .
              </p>
            </div>
          ) : (
            <>
              <p className="mt-6 text-sm font-medium tracking-widest text-muted-foreground uppercase">
                Saved analysis
              </p>
              <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-balance md:text-4xl">
                {detail.prd_title || "Untitled analysis"}
              </h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Scored {fmtDate(detail.created_at)}
              </p>
              <div className="mt-10">
                <SavedReport result={detail.result} />
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
