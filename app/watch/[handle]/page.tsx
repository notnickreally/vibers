import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PromptCamTimeline } from "@/components/stream/prompt-cam-timeline";
import { RunCard } from "@/components/stream/run-card";
import { SidePanel } from "@/components/stream/side-panel";
import { StreamPlayer } from "@/components/stream/stream-player";
import { VibeMeter } from "@/components/stream/vibe-meter";
import { WireFeed } from "@/components/stream/wire-feed";
import { Avatar } from "@/components/ui/avatar";
import { SectionHead, Stat, Tag } from "@/components/ui/bits";
import { compact, shortDuration } from "@/lib/format";
import { isOwnRun } from "@/lib/session";
import {
  PROMPT_CAM,
  VIBERS,
  WIRE,
  getViber,
  liveRunFor,
  liveRuns,
} from "@/lib/mock/data";

export function generateStaticParams() {
  return VIBERS.filter((v) => v.live).map((v) => ({ handle: v.handle }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const run = liveRunFor(handle);
  if (!run) return { title: "Run not found" };
  return {
    title: `@${handle} — ${run.goal}`,
    description: `${run.code} · ${run.tool} · ${compact(run.viewers)} watching on vibers.tv`,
  };
}

export default async function WatchPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const run = liveRunFor(handle);
  const viber = getViber(handle);

  if (!run || !viber) notFound();

  // Fixture transcripts exist for the flagship run; other runs fall back to it
  // so every watch page is readable in this prototype.
  const prompts = PROMPT_CAM[run.code] ?? PROMPT_CAM["RUN-4821"];
  const wire = WIRE[run.code] ?? WIRE["RUN-4821"];
  const inFlight = prompts[prompts.length - 1];
  const stuck = run.vibe < 45;
  const alsoLive = liveRuns()
    .filter((r) => r.handle !== handle)
    .slice(0, 4);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ------------------------------------------------------------ stage */}
        <div className="min-w-0">
          <StreamPlayer
            handle={run.handle}
            code={run.code}
            elapsed={run.elapsed}
            viewers={run.viewers}
            lowerThird={inFlight.text}
            owned={isOwnRun(handle)}
          />

          {/* run header */}
          <div className="mt-5 flex flex-wrap items-start gap-4">
            <Link href={`/u/${handle}`}>
              <Avatar handle={handle} hue={viber.hue} size={52} live />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-faint">
                <span className="tracking-[0.14em] text-amber">{run.code}</span>
                <span aria-hidden>·</span>
                <span>{run.tool}</span>
                <span aria-hidden>·</span>
                <span>{run.model}</span>
                <span aria-hidden>·</span>
                <span>started {run.startedLabel}</span>
              </p>
              <h1 className="mt-1.5 font-display text-xl leading-snug font-semibold text-bone sm:text-2xl">
                {run.goal}
              </h1>
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <Link
                  href={`/u/${handle}`}
                  className="font-mono text-sm text-bone transition-colors hover:text-amber"
                >
                  @{handle}
                </Link>
                <span className="font-mono text-[11px] text-faint">
                  {compact(viber.followers)} followers · {viber.ships} ships
                </span>
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {run.stacks.map((s) => (
                  <Tag key={s} href={`/browse?stack=${encodeURIComponent(s)}`}>
                    {s}
                  </Tag>
                ))}
                <Tag href={`/browse?tool=${encodeURIComponent(run.tool)}`}>{run.tool}</Tag>
              </div>
            </div>
            {/* Full width on mobile so the actions take their own row instead of
                crushing the goal into a column. */}
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <button
                type="button"
                className="flex-1 bg-amber px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone sm:flex-none"
              >
                Follow
              </button>
              <button
                type="button"
                className="flex-1 border border-edge px-4 py-2 font-mono text-[11px] tracking-[0.12em] text-bone uppercase transition-colors hover:border-teal hover:text-teal sm:flex-none"
              >
                Clip 30s
              </button>
              <button
                type="button"
                className="flex-1 border border-edge px-4 py-2 font-mono text-[11px] tracking-[0.12em] text-bone uppercase transition-colors hover:border-amber hover:text-amber sm:flex-none"
              >
                Raid
              </button>
            </div>
          </div>

          {/* rabbit-hole alert — only when the run has genuinely stalled */}
          {stuck && (
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border border-del/40 bg-del/8 p-4">
              <span className="border border-del/50 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em] text-del uppercase">
                Rabbit hole
              </span>
              <p className="min-w-0 flex-1 text-sm text-bone/90">
                {run.prompts} prompts against the same stack trace. A rescue slot is open —
                the top co-prompt goes straight into the composer.
              </p>
              <Link
                href="#co-prompt"
                className="font-mono text-[11px] tracking-[0.1em] text-del uppercase underline-offset-4 hover:underline"
              >
                Write a rescue prompt →
              </Link>
            </div>
          )}

          {/* run stats */}
          <div className="mt-5 grid grid-cols-2 gap-4 border border-edge-soft p-4 sm:grid-cols-5">
            <Stat label="Elapsed" value={shortDuration(run.elapsed)} />
            <Stat label="Prompts" value={String(run.prompts)} />
            <Stat label="Added" value={`+${compact(run.diff.added)}`} tone="text-add" />
            <Stat label="Removed" value={`−${compact(run.diff.removed)}`} tone="text-del" />
            <Stat label="Peak" value={compact(run.peakViewers)} />
          </div>

          {/* prompt-cam */}
          <section className="mt-10" id="prompt-cam">
            <SectionHead
              slate="Prompt-Cam"
              title="Every prompt this run"
              meta={`${prompts.length} shown · ${run.prompts} total`}
            />
            <PromptCamTimeline prompts={prompts} />
          </section>

          {/* about */}
          <section className="mt-10">
            <SectionHead slate="About this run" title={`@${handle}`} />
            <div className="grid gap-6 sm:grid-cols-[2fr_1fr]">
              <p className="text-[15px] leading-relaxed text-muted">{viber.bio}</p>
              <dl className="space-y-3">
                {[
                  ["Ships", String(viber.ships)],
                  ["Assists", String(viber.assists)],
                  ["Week streak", String(viber.streak)],
                  ["Based in", viber.location],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-edge-soft pb-2">
                    <dt className="font-mono text-[11px] tracking-[0.12em] text-faint uppercase">
                      {k}
                    </dt>
                    <dd className="font-mono text-xs text-bone">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        </div>

        {/* ------------------------------------------------------------- rail */}
        <aside
          className="min-w-0 space-y-5 lg:sticky lg:top-20 lg:self-start"
          id="co-prompt"
        >
          <SidePanel handle={handle} wireSlot={<WireFeed events={wire} />} />
          <VibeMeter initial={run.vibe} />
        </aside>
      </div>

      {/* also live */}
      <section className="mt-14">
        <SectionHead
          slate="Also on air"
          title="Runs happening right now"
          meta={`${liveRuns().length - 1} others`}
        />
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {alsoLive.map((r) => (
            <RunCard key={r.id} run={r} compactMode />
          ))}
        </div>
      </section>
    </div>
  );
}
