import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { LiveBadge, Poster, Tag } from "@/components/ui/bits";
import { compact, timecode, vibeLabel, vibeTone } from "@/lib/format";
import { getViber } from "@/lib/mock/data";
import type { Run } from "@/lib/mock/types";

/**
 * A run card leads with the goal, not the streamer — you tune in for what is
 * being attempted. Diff stat and prompt count are the two numbers that tell you
 * what kind of run it is before you click.
 */
export function RunCard({ run, compactMode = false }: { run: Run; compactMode?: boolean }) {
  const viber = getViber(run.handle);
  const net = run.diff.added - run.diff.removed;

  return (
    <article className="group">
      <Link href={`/watch/${run.handle}`} className="block">
        <Poster tone={run.tone} className="aspect-[16/10] transition-colors group-hover:border-amber/60">
          {/* The poster is a monitor frame: goal on top, diff underneath. */}
          <div className="relative flex h-full flex-col justify-between p-3">
            <div className="flex items-start justify-between gap-2">
              {run.status === "live" ? (
                <LiveBadge />
              ) : (
                <span className="border border-edge bg-ink/60 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.16em] text-faint uppercase">
                  {run.status === "scheduled" ? "Soon" : "VOD"}
                </span>
              )}
              <span className="bg-ink/70 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {run.status === "scheduled" ? run.scheduledFor : timecode(run.elapsed)}
              </span>
            </div>

            <div>
              <p className="font-mono text-[10px] tracking-[0.14em] text-amber/80">{run.code}</p>
              <p className="mt-1 line-clamp-2 font-display text-[15px] leading-snug font-semibold text-bone">
                {run.goal}
              </p>
            </div>

            <div className="flex items-end justify-between gap-2 font-mono text-[10px]">
              <span className="flex gap-2">
                <span className="text-add">+{compact(run.diff.added)}</span>
                <span className="text-del">−{compact(run.diff.removed)}</span>
                <span className="text-faint">{run.diff.files}f</span>
              </span>
              <span className="text-faint">{run.prompts} prompts</span>
            </div>
          </div>
        </Poster>
      </Link>

      <div className="mt-3 flex gap-3">
        <Link href={`/u/${run.handle}`} className="shrink-0">
          <Avatar handle={run.handle} hue={viber?.hue ?? 32} size={34} live={run.status === "live"} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link
              href={`/u/${run.handle}`}
              className="truncate font-mono text-xs text-bone transition-colors hover:text-amber"
            >
              @{run.handle}
            </Link>
            <span className="shrink-0 font-mono text-[10px] text-faint">{run.tool}</span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-faint">
            {run.status === "live" ? (
              <span className="text-muted">{compact(run.viewers)} watching</span>
            ) : (
              <span className="text-muted">{compact(run.peakViewers)} peak</span>
            )}
            {run.status !== "scheduled" && (
              <>
                <span aria-hidden>·</span>
                <span className={vibeTone(run.vibe)}>{vibeLabel(run.vibe)}</span>
              </>
            )}
            {!compactMode && net !== 0 && (
              <>
                <span aria-hidden>·</span>
                <span className={net > 0 ? "text-add" : "text-del"}>
                  {net > 0 ? "+" : "−"}
                  {compact(Math.abs(net))} net
                </span>
              </>
            )}
          </p>
          {!compactMode && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {run.stacks.map((s) => (
                <Tag key={s} href={`/browse?stack=${encodeURIComponent(s)}`}>
                  {s}
                </Tag>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
