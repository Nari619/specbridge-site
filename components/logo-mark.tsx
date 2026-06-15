/**
 * SpecBridge logo mark — an abstract geometric "connection" glyph (two nodes
 * joined by a span) in the brand accent. Clean and abstract, not a literal
 * bridge. Size via className (e.g. `size-[22px]`).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="24" height="24" rx="6" className="fill-brand" />
      <path
        d="M8 12h8"
        className="stroke-white"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="8" cy="12" r="2.1" className="fill-white" />
      <circle cx="16" cy="12" r="2.1" className="fill-white" />
    </svg>
  );
}
