"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-edge-soft bg-ink/92 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="group flex items-baseline gap-1.5" aria-label="vibers.tv home">
          <span className="font-display text-xl font-extrabold tracking-[-0.04em] text-bone">
            vibers
          </span>
          <span className="font-mono text-xs font-bold tracking-[0.1em] text-amber transition-colors group-hover:text-teal">
            .tv
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <Link
            href="/"
            className={`px-3 py-1.5 font-mono text-xs tracking-[0.1em] uppercase transition-colors ${
              pathname === "/" ? "text-amber" : "text-muted hover:text-bone"
            }`}
          >
            The wall
          </Link>
        </nav>

        <p className="ml-auto hidden font-mono text-[11px] text-faint sm:block">
          Live coding streams, side by side
        </p>
      </div>
    </header>
  );
}
