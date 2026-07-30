"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The top nav. Two entries, and the second one is the point of it existing:
 * the channels the wall watches are public information about a public wall, so
 * the list is a page beside the wall rather than a section of `/admin`.
 */
const LINKS = [
  { href: "/", label: "The wall" },
  { href: "/channels", label: "Channels" },
] as const;

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
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              className={`px-3 py-1.5 font-mono text-xs tracking-[0.1em] uppercase transition-colors ${
                pathname === link.href ? "text-amber" : "text-muted hover:text-bone"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <p className="ml-auto hidden font-mono text-[11px] text-faint sm:block">
          Live coding streams, side by side
        </p>
      </div>
    </header>
  );
}
