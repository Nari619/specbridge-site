import Link from "next/link";

const linkClass = (active: boolean) =>
  active
    ? "font-medium text-foreground"
    : "text-muted-foreground hover:text-foreground";

/** Shared top nav so /demo and /arc read as one platform. */
export function PlatformNav({ active }: { active: "demo" | "arc" }) {
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          SpecBridge<span className="text-brand">.</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/demo" className={linkClass(active === "demo")}>
            Demo
          </Link>
          <Link href="/arc" className={linkClass(active === "arc")}>
            ARC
          </Link>
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground"
          >
            Site ↗
          </Link>
        </nav>
      </div>
    </header>
  );
}
