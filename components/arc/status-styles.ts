import type { EconomicsVerdict } from "@/lib/arc-economics";
import type { InterventionType } from "@/lib/arc-types";

// Economics verdicts, aligned to /demo's status palette:
// HEALTHY ≈ covered (brand), REVIEW ≈ risky (amber), UNECONOMIC = red,
// UNMEASURED ≈ missing (muted).
export const verdictStyle: Record<
  EconomicsVerdict,
  { dot: string; text: string; chipBorder: string }
> = {
  HEALTHY: {
    dot: "bg-brand",
    text: "text-brand",
    chipBorder: "border-brand/40 bg-brand/5",
  },
  REVIEW: {
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-500",
    chipBorder: "border-amber-500/40 bg-amber-500/5",
  },
  UNECONOMIC: {
    dot: "bg-red-500",
    text: "text-red-600 dark:text-red-500",
    chipBorder: "border-red-500/40 bg-red-500/5",
  },
  UNMEASURED: {
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    chipBorder: "border-border bg-muted/40",
  },
};

// Intervention escalation ladder: warn → throttle → stop, amber → orange → red.
export const interventionStyle: Record<
  InterventionType,
  { dot: string; text: string }
> = {
  warn: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-500" },
  throttle: {
    dot: "bg-orange-500",
    text: "text-orange-600 dark:text-orange-500",
  },
  stop: { dot: "bg-red-500", text: "text-red-600 dark:text-red-500" },
};

// The closed-loop axis: gold = design-time/estimate, cyan = runtime/actual.
export const GOLD_TEXT = "text-amber-600 dark:text-amber-500";
export const CYAN_TEXT = "text-cyan-600 dark:text-cyan-400";
