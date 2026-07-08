"use client";

import { useState } from "react";

type Stage = {
  title: string;
  desc: string;
  icon: React.ReactNode;
  /** the node's own resting accent color (dimmed when idle, full on active) */
  color: string;
  /** small illustrative badge revealed on active (e.g. "e.g. 68%") */
  sample?: string;
  differentiator?: boolean;
};

const ICON = "size-6 md:size-7";

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h11M8 12h11M8 18h11" />
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function GaugeIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 18a8 8 0 0 1 16 0" />
      <path d="M12 18l4-4" />
      <circle cx="12" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.4 12 2.5 2.5 4.7-5" />
    </svg>
  );
}

const stages: Stage[] = [
  {
    title: "PRD Input",
    desc: "Drop in a spec or PRD, the raw requirements to evaluate.",
    icon: <DocIcon />,
    color: "#8b95a7", // slate gray
  },
  {
    title: "Requirement Extraction",
    desc: "SpecBridge parses the spec into atomic, checkable capabilities.",
    icon: <ListIcon />,
    color: "#6fa8dc", // soft blue
  },
  {
    title: "Registry Match",
    desc: "Each capability is matched against your live tool registry.",
    icon: <SearchIcon />,
    color: "#3fb6a8", // teal
  },
  {
    title: "Compliance Gate",
    desc: "Code checks every match for the clearances it needs. Risky is decided here — by rules you can read, not the model.",
    icon: <ShieldIcon />,
    color: "#d4a24e", // amber / gold
    differentiator: true,
  },
  {
    title: "Readiness Score",
    desc: "Covered, partial, risky, and missing roll up into one score.",
    icon: <GaugeIcon />,
    color: "var(--brand)", // brand accent
    sample: "e.g. 68%",
  },
  {
    title: "Decision: GO / NO-GO",
    desc: "A clear verdict, the top blocker, and the path to unblock.",
    icon: <CheckIcon />,
    color: "#4fb286", // muted green
  },
];

function Connector({ index, color }: { index: number; color: string }) {
  const delay = `${index * 0.4}s`;
  return (
    <div
      aria-hidden
      className="relative flex h-8 w-px shrink-0 items-center justify-center border-l border-dashed border-border md:mt-8 md:h-px md:w-auto md:flex-1 md:border-t md:border-l-0"
    >
      {/* dot carries the source node's color; flows down on mobile, right on desktop */}
      <span
        className="absolute left-1/2 size-1.5 -translate-x-1/2 rounded-full motion-reduce:hidden md:hidden"
        style={{
          backgroundColor: color,
          boxShadow: `0 0 6px ${color}`,
          animation: "pipeFlowY 2.6s linear infinite",
          animationDelay: delay,
        }}
      />
      <span
        className="absolute top-1/2 hidden size-1.5 -translate-y-1/2 rounded-full motion-reduce:hidden md:block"
        style={{
          backgroundColor: color,
          boxShadow: `0 0 6px ${color}`,
          animation: "pipeFlowX 2.6s linear infinite",
          animationDelay: delay,
        }}
      />
    </div>
  );
}

export function Pipeline() {
  const [active, setActive] = useState<number | null>(null);
  // Rest on the Compliance Gate (the differentiator) when nothing is hovered.
  const shown = active ?? 3;
  const current = stages[shown];

  return (
    <section className="px-6 py-24 md:py-32">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
            The pipeline
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-balance md:text-4xl">
            One spec in, a decision out.
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Hover any stage to see what happens inside.
          </p>
        </div>

        <div className="mt-14 flex flex-col items-center md:flex-row md:items-start md:justify-center">
          {stages.map((stage, i) => {
            const isActive = shown === i;
            const c = stage.color;
            return (
              <div key={stage.title} className="contents">
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  onClick={() => setActive(i)}
                  aria-label={`${stage.title}: ${stage.desc}`}
                  className="group flex shrink-0 flex-col items-center gap-2.5 outline-none"
                >
                  <span
                    className="relative flex size-14 items-center justify-center rounded-full border bg-card transition-all duration-300 md:size-16"
                    style={{
                      // each node wears its own color: dimmed at rest, full + glow when active
                      borderColor: isActive
                        ? c
                        : `color-mix(in srgb, ${c} 42%, transparent)`,
                      color: isActive
                        ? c
                        : `color-mix(in srgb, ${c} 70%, transparent)`,
                      boxShadow: isActive ? `0 0 26px -6px ${c}` : undefined,
                    }}
                  >
                    {/* looping live-flow pulse ring in the node's own color (subtle, staggered) */}
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full border motion-reduce:hidden"
                      style={{
                        borderColor: c,
                        animation: "pipeNodePulse 3.9s ease-in-out infinite",
                        animationDelay: `${i * 0.6}s`,
                      }}
                    />
                    {stage.icon}
                    {/* small illustrative sample badge — always visible so every
                        visitor sees what a readiness score looks like; brightens
                        to full opacity when this node is active */}
                    {stage.sample && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -top-3 -right-3 rounded-md border bg-card px-1.5 py-0.5 text-[10px] font-medium tracking-tight tabular-nums transition-opacity duration-300"
                        style={{
                          borderColor: c,
                          color: c,
                          opacity: isActive ? 1 : 0.55,
                        }}
                      >
                        {stage.sample}
                      </span>
                    )}
                  </span>
                  <span
                    className="max-w-[7.5rem] text-center text-xs leading-tight font-medium text-muted-foreground transition-colors duration-300 md:max-w-[8rem]"
                    style={isActive ? { color: c } : undefined}
                  >
                    {stage.title}
                  </span>
                </button>
                {i < stages.length - 1 && (
                  <Connector index={i} color={stage.color} />
                )}
              </div>
            );
          })}
        </div>

        {/* description for the hovered / resting stage */}
        <div className="mx-auto mt-12 flex min-h-[3.5rem] max-w-xl items-center justify-center text-center">
          <p className="text-sm leading-relaxed md:text-base">
            <span className="font-medium" style={{ color: current.color }}>
              {current.title}.
            </span>{" "}
            <span className="text-muted-foreground">{current.desc}</span>
          </p>
        </div>
      </div>
    </section>
  );
}
