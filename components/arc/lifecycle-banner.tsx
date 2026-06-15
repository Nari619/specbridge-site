import Link from "next/link";

/**
 * Shared honesty banner: the refund through-line joins a design-time moment
 * (/demo) and a runtime moment (/arc) that, in production, happen weeks apart.
 * No claim of automatic real-time flow.
 */
export function LifecycleBanner({ from }: { from: "demo" | "arc" }) {
  const href = from === "demo" ? "/arc" : "/demo";
  const linkLabel = from === "demo" ? "Open ARC →" : "Open SpecBridge demo →";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3 text-sm">
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">
          Same feature, two moments
        </span>
        : SpecBridge plans it, ARC measures it. In production these run weeks
        apart; joined here so the full lifecycle is visible.
      </p>
      <Link href={href} className="shrink-0 font-medium text-brand hover:underline">
        {linkLabel}
      </Link>
    </div>
  );
}
