import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipCard } from "@/components/stream/clip-card";
import { EmptyState } from "@/components/states";
import { Avatar } from "@/components/ui/avatar";
import { LiveBadge, SectionHead, Tag } from "@/components/ui/bits";
import { compact, shortDuration } from "@/lib/format";
import { PROJECTS, VIBERS, clipsFor, getViber, liveRunFor, runsFor } from "@/lib/mock/data";

export function generateStaticParams() {
  return VIBERS.map((v) => ({ handle: v.handle }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const viber = getViber(handle);
  if (!viber) return { title: "Viber not found" };
  return { title: `@${viber.handle}`, description: viber.bio };
}

const OUTCOME_LABEL = {
  shipped: { label: "Shipped", cls: "text-add" },
  abandoned: { label: "Abandoned", cls: "text-del" },
  "rabbit-hole": { label: "Rabbit hole", cls: "text-del" },
  running: { label: "Running", cls: "text-amber" },
} as const;

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const viber = getViber(handle);
  if (!viber) notFound();

  const live = liveRunFor(handle);
  const runs = runsFor(handle);
  const past = runs.filter((r) => r.status === "ended");
  const clips = clipsFor(handle);
  const projects = PROJECTS[handle] ?? [];
  const shippedRate = runs.length
    ? Math.round((runs.filter((r) => r.outcome === "shipped").length / runs.length) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
      {/* -------------------------------------------------------------- header */}
      <header className="flex flex-wrap items-start gap-6 border-b border-edge-soft pb-8">
        <Avatar handle={handle} hue={viber.hue} size={88} live={viber.live} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-bone">
              @{viber.handle}
            </h1>
            {live && <LiveBadge />}
          </div>
          <p className="mt-1 font-mono text-xs text-faint">
            {viber.name} · {viber.pronouns} · {viber.location} · joined {viber.joined}
          </p>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">{viber.bio}</p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {viber.stacks.map((s) => (
              <Tag key={s} href={`/browse?stack=${encodeURIComponent(s)}`}>
                {s}
              </Tag>
            ))}
            {viber.tools.map((t) => (
              <Tag key={t} href={`/browse?tool=${encodeURIComponent(t)}`}>
                {t}
              </Tag>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="bg-amber px-5 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
          >
            Follow
          </button>
          {live && (
            <Link
              href={`/watch/${handle}`}
              className="border border-tally px-5 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-tally uppercase transition-colors hover:bg-tally hover:text-ink"
            >
              Watch live
            </Link>
          )}
        </div>
      </header>

      {/* --------------------------------------------------------------- stats */}
      <dl className="grid grid-cols-2 gap-px border-x border-b border-edge-soft bg-edge-soft sm:grid-cols-5">
        {[
          ["Followers", compact(viber.followers)],
          ["Ships", String(viber.ships)],
          ["Assists", String(viber.assists)],
          ["Week streak", String(viber.streak)],
          ["Ship rate", `${shippedRate}%`],
        ].map(([k, v]) => (
          <div key={k} className="bg-ink px-4 py-4">
            <dt className="eyebrow">{k}</dt>
            <dd className="mt-1 font-mono text-xl text-bone tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      {/* ------------------------------------------------------------ live now */}
      {live && (
        <section className="mt-12">
          <SectionHead slate="On air" title="Live right now" meta={`${compact(live.viewers)} watching`} />
          <Link href={`/watch/${handle}`} className="group block border border-edge-soft p-5 transition-colors hover:border-amber/60">
            <p className="font-mono text-[11px] tracking-[0.14em] text-amber">{live.code}</p>
            <p className="mt-2 font-display text-xl leading-snug font-semibold text-bone group-hover:text-amber">
              {live.goal}
            </p>
            <p className="mt-3 flex flex-wrap gap-x-4 font-mono text-[11px] text-faint">
              <span>{shortDuration(live.elapsed)} elapsed</span>
              <span>{live.prompts} prompts</span>
              <span className="text-add">+{compact(live.diff.added)}</span>
              <span className="text-del">−{compact(live.diff.removed)}</span>
            </p>
          </Link>
        </section>
      )}

      {/* -------------------------------------------------------------- shipped */}
      <section className="mt-12">
        <SectionHead
          slate="Shipped"
          title="Things that exist because of a run"
          meta={projects.length ? `${projects.length} live` : undefined}
        />
        {projects.length === 0 ? (
          <EmptyState
            slate="Nothing shipped yet"
            title="No finished projects on this profile"
            body="Runs are logged from the first prompt, but a project only lands here once something is deployed and reachable."
            action={{ label: "See their runs", href: `/browse?stack=${viber.stacks[0]}` }}
          />
        ) : (
          <ul className="divide-y divide-edge-soft border border-edge-soft">
            {projects.map((p) => (
              <li key={p.name} className="flex flex-wrap items-baseline gap-x-6 gap-y-2 p-5">
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-semibold text-bone">{p.name}</p>
                  <p className="mt-1 max-w-xl text-sm text-muted">{p.blurb}</p>
                </div>
                <p className="font-mono text-[11px] text-faint">
                  {p.runs} runs · shipped {p.shipped}
                </p>
                <p className="font-mono text-[11px] text-teal">{p.url}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ----------------------------------------------------------- past runs */}
      <section className="mt-12">
        <SectionHead
          slate="Run log"
          title="Every run, including the losses"
          meta={`${runs.length} recorded`}
        />
        {past.length === 0 ? (
          <EmptyState
            slate="No archive"
            title="Nothing in the run log yet"
            body="Finished runs land here with their full prompt transcript and diff, whether or not they shipped."
            action={{ label: "Browse live runs", href: "/browse" }}
          />
        ) : (
          <ul className="divide-y divide-edge-soft border border-edge-soft">
            {past.map((r) => {
              const outcome = OUTCOME_LABEL[r.outcome];
              return (
                <li key={r.id} className="grid gap-2 p-5 sm:grid-cols-[7rem_1fr_auto] sm:items-baseline">
                  <p className="font-mono text-[11px] text-faint">{r.code}</p>
                  <div className="min-w-0">
                    <p className="font-display text-base leading-snug font-semibold text-bone">
                      {r.goal}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-faint">
                      <span>{shortDuration(r.elapsed)}</span>
                      <span>{r.prompts} prompts</span>
                      <span className="text-add">+{compact(r.diff.added)}</span>
                      <span className="text-del">−{compact(r.diff.removed)}</span>
                      <span>{compact(r.peakViewers)} peak</span>
                    </p>
                  </div>
                  <span className={`font-mono text-[11px] tracking-[0.12em] uppercase ${outcome.cls}`}>
                    {outcome.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* --------------------------------------------------------------- clips */}
      <section className="mt-12">
        <SectionHead slate="Clips" title="Cut from their runs" meta={`${clips.length} clips`} />
        {clips.length === 0 ? (
          <EmptyState
            slate="No clips"
            title="Nobody has clipped this viber yet"
            body="Clips are cut live by the audience, or automatically when a run ships. Watch a run and take the first one."
            action={{ label: "Browse live runs", href: "/browse" }}
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {clips.map((c) => (
              <ClipCard key={c.id} clip={c} />
            ))}
          </div>
        )}
      </section>

      {/* --------------------------------------------------------------- other */}
      <section className="mt-12">
        <SectionHead slate="Elsewhere" title="Other vibers on this stack" />
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {VIBERS.filter(
            (v) => v.handle !== handle && v.stacks.some((s) => viber.stacks.includes(s)),
          )
            .slice(0, 4)
            .map((v) => (
              <Link
                key={v.handle}
                href={`/u/${v.handle}`}
                className="flex items-center gap-3 border border-edge-soft p-4 transition-colors hover:border-amber/50"
              >
                <Avatar handle={v.handle} hue={v.hue} size={40} live={v.live} />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-sm text-bone">@{v.handle}</span>
                  <span className="block font-mono text-[11px] text-faint">
                    {compact(v.followers)} followers · {v.ships} ships
                  </span>
                </span>
              </Link>
            ))}
        </div>
      </section>
    </div>
  );
}
