import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-20 border-t border-edge-soft bg-ink-2">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-display text-2xl font-extrabold tracking-[-0.04em] text-bone">
            vibers<span className="text-amber">.tv</span>
          </p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
            A wall of live coding streams. Every video is played from YouTube&apos;s own
            player and belongs to the channel that made it — vibers.tv hosts nothing and
            claims nothing.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Link
            href="/"
            className="font-mono text-xs tracking-[0.1em] text-muted uppercase transition-colors hover:text-bone"
          >
            The wall
          </Link>
          <Link
            href="/report"
            className="font-mono text-xs tracking-[0.1em] text-muted uppercase transition-colors hover:text-bone"
          >
            Report a stream
          </Link>
        </div>
      </div>
      <div className="border-t border-edge-soft">
        <div className="mx-auto max-w-[1600px] px-4 py-4 font-mono text-[11px] text-faint sm:px-6">
          Your wall is stored in this browser only.
        </div>
      </div>
    </footer>
  );
}
