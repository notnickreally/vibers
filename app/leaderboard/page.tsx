import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { SectionHead } from "@/components/ui/bits";
import { compact } from "@/lib/format";
import { LEADERBOARD, VIBERS, getViber } from "@/lib/mock/data";

export const metadata: Metadata = {
  title: "Boards",
  description: "Ships, assists and one-shots. Follower counts are not ranked here.",
};

const BOARDS = [
  {
    key: "ships",
    title: "Ships",
    rows: LEADERBOARD.ships,
    unit: "runs that ended in a deploy",
    tone: "text-add",
  },
  {
    key: "assists",
    title: "Assists",
    rows: LEADERBOARD.assists,
    unit: "co-prompts adopted by someone else",
    tone: "text-teal",
  },
  {
    key: "oneShots",
    title: "One-shots",
    rows: LEADERBOARD.oneShots,
    unit: "goals hit with a single prompt",
    tone: "text-amber",
  },
];

export default function LeaderboardPage() {
  const byStreak = [...VIBERS].sort((a, b) => b.streak - a.streak).slice(0, 6);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
      <SectionHead
        slate="Boards"
        title="This week on the network"
        meta="Resets Monday 00:00 UTC"
      />

      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-muted">
        Nothing here ranks by followers. A run counts when it ends, an assist counts when
        someone else adopts your prompt, and a one-shot counts only if the goal was declared
        before the prompt was sent.
      </p>

      <div className="grid gap-6 lg:grid-cols-3">
        {BOARDS.map((board) => {
          const max = Math.max(...board.rows.map((r) => r.value));
          return (
            <section key={board.key} className="panel p-5">
              <div className="border-b border-edge-soft pb-3">
                <h2 className="font-display text-xl font-semibold text-bone">{board.title}</h2>
                <p className="mt-1 font-mono text-[10px] tracking-[0.1em] text-faint uppercase">
                  {board.unit}
                </p>
              </div>
              <ol className="mt-4 space-y-4">
                {board.rows.map((row, i) => {
                  const viber = getViber(row.handle);
                  return (
                    <li key={row.handle}>
                      <div className="flex items-center gap-3">
                        <span className="w-4 font-mono text-[11px] text-faint tabular-nums">
                          {i + 1}
                        </span>
                        <Avatar handle={row.handle} hue={viber?.hue ?? 200} size={26} live={viber?.live} />
                        <Link
                          href={`/u/${row.handle}`}
                          className="truncate font-mono text-xs text-bone transition-colors hover:text-amber"
                        >
                          @{row.handle}
                        </Link>
                        <span className={`ml-auto font-mono text-sm tabular-nums ${board.tone}`}>
                          {row.value}
                        </span>
                      </div>
                      <div className="mt-1.5 ml-7 h-1 bg-ink">
                        <div
                          className="h-full bg-current opacity-60"
                          style={{ width: `${(row.value / max) * 100}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      <section className="mt-14">
        <SectionHead
          slate="Streaks"
          title="Consecutive weeks with a ship"
          meta="A zero is not hidden"
        />
        <ul className="divide-y divide-edge-soft border border-edge-soft">
          {byStreak.map((v) => (
            <li key={v.handle} className="flex flex-wrap items-center gap-4 p-4">
              <Avatar handle={v.handle} hue={v.hue} size={34} live={v.live} />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/u/${v.handle}`}
                  className="font-mono text-sm text-bone transition-colors hover:text-amber"
                >
                  @{v.handle}
                </Link>
                <p className="font-mono text-[11px] text-faint">
                  {compact(v.followers)} followers · {v.ships} ships
                </p>
              </div>
              <div className="flex items-center gap-1" aria-label={`${v.streak} week streak`}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-4 w-1.5 ${i < Math.min(v.streak, 12) ? "bg-add" : "bg-edge"}`}
                    aria-hidden
                  />
                ))}
              </div>
              <span className="w-16 text-right font-mono text-sm text-bone tabular-nums">
                {v.streak}w
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
