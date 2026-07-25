import Link from "next/link";

const COLUMNS: { slate: string; links: { label: string; href: string }[] }[] = [
  {
    slate: "Watch",
    links: [
      { label: "Live now", href: "/browse" },
      { label: "Clips", href: "/clips" },
      { label: "Feed", href: "/feed" },
      { label: "Boards", href: "/leaderboard" },
    ],
  },
  {
    slate: "Broadcast",
    links: [
      { label: "Go live", href: "/go-live" },
      { label: "Prompt-Cam setup", href: "/go-live" },
      { label: "Wire integrations", href: "/go-live" },
      { label: "Run rules", href: "/go-live" },
      { label: "Report a feed", href: "/report" },
    ],
  },
  {
    slate: "Reference",
    links: [
      { label: "UI states", href: "/states" },
      { label: "What is a run?", href: "/browse" },
      { label: "Co-prompting", href: "/watch/nocturne" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-20 border-t border-edge-soft bg-ink-2">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <p className="font-display text-2xl font-extrabold tracking-[-0.04em] text-bone">
            vibers<span className="text-amber">.tv</span>
          </p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
            The prompt is the performance. Watch people build things live, from empty
            repo to deploy — including the runs that don&apos;t make it.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.slate}>
            <p className="eyebrow">{col.slate}</p>
            <ul className="mt-3 space-y-2">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted transition-colors hover:text-bone"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-edge-soft">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-4 font-mono text-[11px] text-faint sm:px-6">
          <p>vibers.tv — prototype build, fixture data throughout</p>
          <p>No run was pre-recorded in the making of this page</p>
        </div>
      </div>
    </footer>
  );
}
