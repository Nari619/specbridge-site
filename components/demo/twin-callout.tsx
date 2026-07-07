import type { TwinMatch } from "@/lib/twin-detection";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "previously";
  const days = Math.round((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/**
 * Twin-catcher callout — a distinct attention banner at the TOP of the report,
 * shown ONLY when a genuinely-overlapping past PRD is found. Names the match and
 * the specific shared capabilities so it's a decision tool, not a "similar PRD
 * exists" gimmick.
 */
export function TwinCallout({ twin }: { twin: TwinMatch }) {
  const pct = Math.round(twin.score * 100);
  const n = twin.overlaps.length;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-500"
        >
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p className="text-sm font-semibold tracking-tight text-amber-700 dark:text-amber-500">
          Similar PRD detected — you may be duplicating work
        </p>
      </div>

      <p className="mt-3 text-sm text-foreground">
        <span className="font-medium">{twin.title}</span>{" "}
        <span className="text-muted-foreground">
          was analyzed {relativeTime(twin.created_at)} · {pct}% similar
        </span>
      </p>

      {n > 0 && (
        <>
          <p className="mt-4 text-xs font-medium tracking-widest text-muted-foreground uppercase">
            {n} overlapping capabilit{n === 1 ? "y" : "ies"} you both need
          </p>
          <ul className="mt-2 space-y-1.5">
            {twin.overlaps.slice(0, 6).map((o, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
                <span>
                  {o.current_requirement}
                  {o.matched_tool && (
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                      {o.matched_tool}
                    </span>
                  )}
                </span>
              </li>
            ))}
            {n > 6 && (
              <li className="pl-3.5 text-xs text-muted-foreground">
                and {n - 6} more
              </li>
            )}
          </ul>
        </>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Review the existing work before building. Reach out to that team to
        reuse, extend, or de-duplicate.
      </p>
    </div>
  );
}
