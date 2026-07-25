"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { compact } from "@/lib/format";
import { liveRuns } from "@/lib/mock/data";

const NAV = [
  { href: "/browse", label: "Live" },
  { href: "/feed", label: "Feed" },
  { href: "/clips", label: "Clips" },
  { href: "/relay", label: "Relay" },
  { href: "/leaderboard", label: "Boards" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const live = liveRuns();
  const watching = live.reduce((n, r) => n + r.viewers, 0);

  return (
    <header className="sticky top-0 z-50 border-b border-edge-soft bg-ink/92 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="group flex items-baseline gap-1.5" aria-label="vibers.tv home">
          <span className="font-display text-xl font-extrabold tracking-[-0.04em] text-bone">
            vibers
          </span>
          <span className="font-mono text-xs font-bold tracking-[0.1em] text-amber transition-colors group-hover:text-teal">
            .tv
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 font-mono text-xs tracking-[0.1em] uppercase transition-colors ${
                  active ? "text-amber" : "text-muted hover:text-bone"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <p className="hidden font-mono text-[11px] text-faint sm:block">
            <span className="text-tally">{live.length}</span> on air ·{" "}
            <span className="text-bone">{compact(watching)}</span> watching
          </p>
          <Link
            href="/go-live"
            className="border border-edge px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-bone uppercase transition-colors hover:border-tally hover:text-tally"
          >
            Go live
          </Link>
          <Link href="/u/nocturne" aria-label="Your profile">
            <Avatar handle="nocturne" hue={32} size={30} />
          </Link>
        </div>
      </div>
    </header>
  );
}
