"use client";

import { motion, useReducedMotion } from "framer-motion";
import { NumberTicker } from "@/components/ui/number-ticker";

const SIZE = 200;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreArc({ value }: { value: number }) {
  const reduceMotion = useReducedMotion();
  const target = CIRCUMFERENCE * (1 - value / 100);

  return (
    <div
      className="relative"
      style={{ width: SIZE, height: SIZE }}
      role="img"
      aria-label={`Readiness score: ${value} percent`}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        fill="none"
        className="-rotate-90"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          className="stroke-border"
        />
        <motion.circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          className="stroke-brand"
          initial={{ strokeDashoffset: reduceMotion ? target : CIRCUMFERENCE }}
          animate={{ strokeDashoffset: target }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.1 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-5xl font-semibold tracking-tight tabular-nums">
          <NumberTicker
            value={value}
            delay={0.1}
            className="tracking-tight text-current dark:text-current"
          />
          <span className="text-brand">%</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">readiness</p>
      </div>
    </div>
  );
}
