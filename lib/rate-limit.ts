/**
 * Per-IP in-memory rate limiter for the demo's paid endpoint (/api/analyze).
 *
 * Threat model: curious visitors and stray bots, not determined attackers.
 * Zero new infrastructure — a Map in the serverless instance's memory. The
 * cold-start reset (and per-instance isolation) is acceptable for the demo
 * phase; the durable Supabase/Upstash-counter version is the going-public
 * upgrade (see pre-launch TODO). Sliding window: only successful (allowed)
 * requests are counted, so a rate-limited visitor's retries don't extend the
 * window.
 */

/** Max paid analyses per IP within the window. */
export const RATE_LIMIT_MAX = 5;
/** Rolling window length. */
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

const hits = new Map<string, number[]>();

export function checkRateLimit(ip: string): {
  allowed: boolean;
  retryAfterSec: number;
} {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recent = (hits.get(ip) ?? []).filter((t) => t > windowStart);

  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(ip, recent); // keep the pruned list
    const retryAfterSec = Math.max(
      1,
      Math.ceil((recent[0] + RATE_LIMIT_WINDOW_MS - now) / 1000),
    );
    return { allowed: false, retryAfterSec };
  }

  recent.push(now);
  hits.set(ip, recent);
  return { allowed: true, retryAfterSec: 0 };
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
