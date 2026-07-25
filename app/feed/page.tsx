import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { SectionHead } from "@/components/ui/bits";
import { compact } from "@/lib/format";
import { CLIPS, FEED, LEADERBOARD, getViber, liveRuns } from "@/lib/mock/data";
import type { FeedPost } from "@/lib/mock/types";

export const metadata: Metadata = {
  title: "Feed",
  description: "Ship moments, clips, prompts and post-mortems from across the network.",
};

/** Posts are typed by what happened. The type sets the card, not the mood. */
const KIND: Record<FeedPost["kind"], { label: string; cls: string }> = {
  ship: { label: "Shipped", cls: "text-add border-add/40" },
  clip: { label: "Clip", cls: "text-teal border-teal/40" },
  prompt: { label: "Prompt", cls: "text-amber border-amber/40" },
  milestone: { label: "Milestone", cls: "text-amber border-amber/40" },
  raid: { label: "Raid", cls: "text-amber border-amber/40" },
  run: { label: "Post-mortem", cls: "text-del border-del/40" },
};

export default function FeedPage() {
  const live = liveRuns().slice(0, 4);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <SectionHead
            slate="Feed"
            title="What just happened"
            meta="Everyone you follow, plus the network wire"
          />

          {/* composer */}
          <div className="panel mb-8 p-4">
            <div className="flex gap-3">
              <Avatar handle="nocturne" hue={32} size={36} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted">
                  Post a prompt, a diff, or the reason you gave up. Runs post themselves.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["Prompt", "Diff", "Clip", "Post-mortem"].map((t) => (
                    <span
                      key={t}
                      className="border border-edge px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-muted uppercase"
                    >
                      {t}
                    </span>
                  ))}
                  <button
                    type="button"
                    className="ml-auto bg-amber px-4 py-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
                  >
                    Post
                  </button>
                </div>
              </div>
            </div>
          </div>

          <ul className="space-y-5">
            {FEED.map((post) => {
              const viber = getViber(post.handle);
              const kind = KIND[post.kind];
              const clip = post.clipId ? CLIPS.find((c) => c.id === post.clipId) : undefined;

              return (
                <li key={post.id} className="panel p-5">
                  <div className="flex items-start gap-3">
                    <Link href={`/u/${post.handle}`}>
                      <Avatar handle={post.handle} hue={viber?.hue ?? 32} size={38} live={viber?.live} />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link
                          href={`/u/${post.handle}`}
                          className="font-mono text-sm text-bone transition-colors hover:text-amber"
                        >
                          @{post.handle}
                        </Link>
                        <span
                          className={`border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] uppercase ${kind.cls}`}
                        >
                          {kind.label}
                        </span>
                        <span className="font-mono text-[11px] text-faint">{post.when}</span>
                        {post.runCode && (
                          <Link
                            href={`/watch/${post.handle}`}
                            className="font-mono text-[11px] text-faint transition-colors hover:text-teal"
                          >
                            {post.runCode}
                          </Link>
                        )}
                      </p>

                      <p className="mt-2 text-[15px] leading-relaxed text-bone/90">{post.body}</p>

                      {/* prompt payload */}
                      {post.promptText && (
                        <div className="mt-3 border-l-2 border-amber bg-ink px-3 py-2.5">
                          <p className="font-mono text-[12px] leading-relaxed text-bone/85">
                            <span className="mr-1.5 text-amber">›</span>
                            {post.promptText}
                          </p>
                        </div>
                      )}

                      {/* diff payload */}
                      {post.diff && (
                        <div className="mt-3 flex flex-wrap gap-x-5 border border-edge-soft bg-ink px-3 py-2.5 font-mono text-[11px]">
                          <span className="text-faint">{post.diff.files} files</span>
                          <span className="text-add">+{compact(post.diff.added)}</span>
                          <span className="text-del">−{compact(post.diff.removed)}</span>
                          <span className="text-faint">
                            net {post.diff.added - post.diff.removed > 0 ? "+" : "−"}
                            {compact(Math.abs(post.diff.added - post.diff.removed))}
                          </span>
                        </div>
                      )}

                      {/* clip payload */}
                      {clip && (
                        <Link
                          href={`/watch/${clip.handle}`}
                          className="mt-3 flex items-center gap-3 border border-edge-soft bg-ink p-3 transition-colors hover:border-teal/50"
                        >
                          <span className="grid h-11 w-16 shrink-0 place-items-center border border-edge bg-panel-2 font-mono text-[10px] text-teal">
                            0:{String(clip.seconds).padStart(2, "0")}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-bone">{clip.title}</span>
                            <span className="block font-mono text-[11px] text-faint">
                              {compact(clip.views)} views
                            </span>
                          </span>
                        </Link>
                      )}

                      <div className="mt-4 flex gap-5 font-mono text-[11px] text-faint">
                        <button type="button" className="transition-colors hover:text-amber">
                          ♥ {compact(post.likes)}
                        </button>
                        <button type="button" className="transition-colors hover:text-teal">
                          ↩ {post.replies}
                        </button>
                        <button type="button" className="transition-colors hover:text-bone">
                          ↗ share
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* --------------------------------------------------------------- rail */}
        <aside className="space-y-6">
          <div className="panel p-4">
            <p className="eyebrow">Live from your follows</p>
            <ul className="mt-3 space-y-3">
              {live.map((r) => {
                const v = getViber(r.handle);
                return (
                  <li key={r.id}>
                    <Link href={`/watch/${r.handle}`} className="group flex items-start gap-2.5">
                      <Avatar handle={r.handle} hue={v?.hue ?? 32} size={28} live />
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs text-bone group-hover:text-amber">
                          @{r.handle}
                        </span>
                        <span className="line-clamp-2 block text-[12px] leading-snug text-muted">
                          {r.goal}
                        </span>
                        <span className="mt-0.5 block font-mono text-[10px] text-faint">
                          {compact(r.viewers)} watching
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Link
              href="/browse"
              className="mt-4 block border border-edge px-3 py-2 text-center font-mono text-[10px] tracking-[0.12em] text-muted uppercase transition-colors hover:border-amber hover:text-amber"
            >
              Browse all live
            </Link>
          </div>

          <div className="panel p-4">
            <div className="flex items-baseline justify-between">
              <p className="eyebrow">Assists this week</p>
              <p className="font-mono text-[10px] text-faint">resets Mon</p>
            </div>
            <ol className="mt-3 space-y-2.5">
              {LEADERBOARD.assists.map((row, i) => {
                const v = getViber(row.handle);
                return (
                  <li key={row.handle} className="flex items-center gap-2.5">
                    <span className="w-3 font-mono text-[10px] text-faint tabular-nums">{i + 1}</span>
                    <Avatar handle={row.handle} hue={v?.hue ?? 200} size={22} />
                    <Link
                      href={`/u/${row.handle}`}
                      className="truncate font-mono text-[11px] text-muted transition-colors hover:text-bone"
                    >
                      @{row.handle}
                    </Link>
                    <span className="ml-auto font-mono text-[11px] text-teal tabular-nums">
                      {row.value}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
