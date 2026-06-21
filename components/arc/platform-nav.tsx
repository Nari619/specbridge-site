import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";

const linkClass = (active: boolean) =>
  active
    ? "font-medium text-foreground"
    : "text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground";

/** Shared top nav so /demo, /arc, and /dashboard read as one platform. */
export function PlatformNav({
  active,
  showTagline = true,
}: {
  active: "demo" | "arc" | "dashboard";
  showTagline?: boolean;
}) {
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <LogoMark className="size-[22px]" />
          <div className="flex flex-col">
            <Link
              href="/"
              className="text-lg font-semibold leading-tight tracking-tight"
            >
              SpecBridge<span className="text-brand">.</span>
            </Link>
            {showTagline && (
              <p className="text-xs leading-tight text-muted-foreground">
                Know what&rsquo;s built. Before you build.
              </p>
            )}
          </div>
        </div>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/demo" className={linkClass(active === "demo")}>
            Demo
          </Link>
          <Link
            href="/dashboard"
            className={linkClass(active === "dashboard")}
          >
            Dashboard
          </Link>
          <Link
            href="/"
            className="text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground"
          >
            Site ↗
          </Link>
        </nav>
      </div>
    </header>
  );
}
