import Link from "next/link";
import { HeroConsole } from "@/components/stream/hero-console";
import { RunCard } from "@/components/stream/run-card";
import { ClipCard } from "@/components/stream/clip-card";
import { Avatar } from "@/components/ui/avatar";
import { Button, SectionHead, Tag } from "@/components/ui/bits";
import { compact } from "@/lib/format";
import { CLIPS, LEADERBOARD, RUNS, STACK_RAIL, getViber, liveRuns } from "@/lib/mock/data";

/** The six surfaces that make a run watchable. This is the product thesis. */
const SURFACES = [
  {
    slate: "Prompt-Cam",
    title: "The prompt is the face cam",
    body: "Every prompt a viber sends is on screen as they type it, with the token count and what it cost them. You are watching someone think, not someone's forehead.",
  },
  {
    slate: "The Wire",
    title: "Diffs land in public",
    body: "Commits, reverts, passing suites and deploys stream out of the editor as they happen. Green means added, and the network-wide wire never stops moving.",
  },
  {
    slate: "Co-prompt",
    title: "Backseat prompting, but sanctioned",
    body: "Chat writes prompts, chat votes them up, the streamer adopts or declines. An adopted prompt is credited to its author forever and counts toward their assists.",
  },
  {
    slate: "Ship moment",
    title: "A deploy is an event",
    body: "When the build goes green the run clips itself, the wire lights up, and the post writes itself to the feed. Shipping is the only metric the site ranks on.",
  },
  {
    slate: "Vibe meter",
    title: "Honest audience read",
    body: "Viewers set the temperature from locked in to cooked. A struggling run is not hidden — half the audience is here specifically for that.",
  },
  {
    slate: "Rabbit-hole alert",
    title: "The site notices when you're stuck",
    body: "Three prompts against the same stack trace and the run is flagged. Chat gets a rescue slot, and the clip that comes out of it is worth more than the fix.",
  },
];

export default function HomePage() {
  const live = liveRuns();
  const watching = live.reduce((n, r) => n + r.viewers, 0);
  const promptsToday = live.reduce((n, r) => n + r.prompts, 0);
  const featured = live.slice(0, 8);
  const upcoming = RUNS.filter((r) => r.status === "scheduled");

  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <section className="border-b border-edge-soft">
        <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:py-16">
          <div className="flex flex-col justify-center">
            <p className="eyebrow">Live now · {live.length} runs on air</p>
            <h1 className="mt-4 font-display text-[2.75rem] leading-[0.98] font-extrabold tracking-[-0.035em] text-bone sm:text-6xl">
              Somebody is
              <br />
              building it
              <br />
              <span className="text-amber">right now.</span>
            </h1>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted">
              vibers.tv is where vibecoders broadcast the loop — prompt in, diff out,
              ship or revert. No edits, no tutorial voice, no pretending the first
              attempt worked.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/browse">Watch a run</Button>
              <Button href="/go-live" variant="ghost">
                Go live
              </Button>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-edge-soft pt-6">
              {[
                { label: "Watching", value: compact(watching) },
                { label: "Prompts live", value: String(promptsToday) },
                { label: "Shipped today", value: "148" },
              ].map((s) => (
                <div key={s.label} className="flex flex-col justify-between">
                  <dt className="eyebrow">{s.label}</dt>
                  <dd className="mt-1 font-mono text-xl text-bone tabular-nums">{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex items-center">
            <div className="w-full">
              <HeroConsole />
              <p className="mt-3 font-mono text-[11px] text-faint">
                A real frame from RUN-4821. It reverts in about forty seconds.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ live grid */}
      <section className="mx-auto max-w-[1440px] px-4 py-14 sm:px-6">
        <SectionHead
          slate="On air"
          title="Live runs"
          meta={`${live.length} broadcasting · ${compact(watching)} watching`}
          action={
            <Link
              href="/browse"
              className="font-mono text-xs tracking-[0.1em] text-amber uppercase transition-colors hover:text-bone"
            >
              Browse all →
            </Link>
          }
        />
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {featured.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- the surfaces */}
      <section className="border-y border-edge-soft bg-ink-2">
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6">
          <SectionHead
            slate="What you're watching"
            title="Six things a run puts on screen"
            meta="Every one of them is on the watch page"
          />
          <div className="grid gap-px overflow-hidden border border-edge-soft bg-edge-soft sm:grid-cols-2 lg:grid-cols-3">
            {SURFACES.map((s) => (
              <div key={s.slate} className="bg-ink-2 p-6 transition-colors hover:bg-panel">
                <p className="eyebrow text-amber">{s.slate}</p>
                <h3 className="mt-3 text-lg leading-snug font-semibold text-bone">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- stacks */}
      <section className="mx-auto max-w-[1440px] px-4 py-14 sm:px-6">
        <SectionHead
          slate="Categories"
          title="Runs are filed by stack"
          meta="Not by game. By what's in the repo."
        />
        <div className="flex flex-wrap gap-2">
          {STACK_RAIL.map((s) => (
            <Link
              key={s.label}
              href={`/browse?stack=${encodeURIComponent(s.label)}`}
              className="group flex items-center gap-3 border border-edge-soft bg-panel px-4 py-3 transition-colors hover:border-amber/50"
            >
              <span
                className="h-8 w-1"
                style={{ background: `hsl(${s.hue} 70% 55%)` }}
                aria-hidden
              />
              <span>
                <span className="block font-mono text-sm text-bone group-hover:text-amber">
                  {s.label}
                </span>
                <span className="block font-mono text-[11px] text-faint">
                  {compact(s.count)} runs this week
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- clips */}
      <section className="mx-auto max-w-[1440px] px-4 py-14 sm:px-6">
        <SectionHead
          slate="Clips"
          title="Cut from live runs"
          meta="Ships, rescues and rabbit holes"
          action={
            <Link
              href="/clips"
              className="font-mono text-xs tracking-[0.1em] text-amber uppercase transition-colors hover:text-bone"
            >
              All clips →
            </Link>
          }
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CLIPS.slice(0, 6).map((clip) => (
            <ClipCard key={clip.id} clip={clip} />
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------------- boards */}
      <section className="border-t border-edge-soft bg-ink-2">
        <div className="mx-auto max-w-[1440px] px-4 py-16 sm:px-6">
          <SectionHead
            slate="Boards"
            title="This week"
            meta="Ships beat followers here"
            action={
              <Link
                href="/leaderboard"
                className="font-mono text-xs tracking-[0.1em] text-amber uppercase transition-colors hover:text-bone"
              >
                Full boards →
              </Link>
            }
          />
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { title: "Ships", rows: LEADERBOARD.ships, unit: "shipped" },
              { title: "Assists", rows: LEADERBOARD.assists, unit: "adopted" },
              { title: "One-shots", rows: LEADERBOARD.oneShots, unit: "no follow-ups" },
            ].map((board) => (
              <div key={board.title} className="panel p-4">
                <div className="flex items-baseline justify-between border-b border-edge-soft pb-2">
                  <p className="font-mono text-xs tracking-[0.14em] text-bone uppercase">
                    {board.title}
                  </p>
                  <p className="font-mono text-[10px] text-faint">{board.unit}</p>
                </div>
                <ol className="mt-3 space-y-2.5">
                  {board.rows.map((row, i) => {
                    const viber = getViber(row.handle);
                    return (
                      <li key={row.handle} className="flex items-center gap-3">
                        <span className="w-4 font-mono text-[11px] text-faint tabular-nums">
                          {i + 1}
                        </span>
                        <Avatar handle={row.handle} hue={viber?.hue ?? 200} size={24} />
                        <Link
                          href={`/u/${row.handle}`}
                          className="truncate font-mono text-xs text-muted transition-colors hover:text-bone"
                        >
                          @{row.handle}
                        </Link>
                        <span className="ml-auto font-mono text-xs text-amber tabular-nums">
                          {row.value}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- upcoming */}
      {upcoming.length > 0 && (
        <section className="mx-auto max-w-[1440px] px-4 py-14 sm:px-6">
          <SectionHead slate="Scheduled" title="Going live soon" meta="Set a reminder, or don't" />
          <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {upcoming.map((run) => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------- cta */}
      <section className="mx-auto max-w-[1440px] px-4 pb-8 sm:px-6">
        <div className="panel flex flex-col items-start gap-6 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div>
            <p className="eyebrow text-tally">Your turn</p>
            <h2 className="mt-2 max-w-lg text-2xl leading-tight font-semibold text-bone sm:text-3xl">
              Declare a goal, hit the tally, and let people watch you find out.
            </h2>
            <p className="mt-3 max-w-lg text-sm text-muted">
              Point the Wire at your repo, turn on the Prompt-Cam, and every run you
              finish — shipped or not — becomes a page someone can learn from.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tag>Claude Code</Tag>
            <Tag>Cursor</Tag>
            <Tag>Codex</Tag>
            <Tag>Zed</Tag>
            <Button href="/go-live" className="mt-2 w-full sm:mt-0 sm:w-auto">
              Start a run
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
