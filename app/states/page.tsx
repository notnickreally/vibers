import type { Metadata } from "next";
import Link from "next/link";
import { RunCard } from "@/components/stream/run-card";
import { EmptyState, ErrorState, PartialBanner, RunGridSkeleton } from "@/components/states";
import { SectionHead } from "@/components/ui/bits";
import { liveRuns } from "@/lib/mock/data";
import type { Run } from "@/lib/mock/types";

export const metadata: Metadata = {
  title: "UI states",
  description: "Every state a run list has to survive, designed rather than defaulted.",
};

/** The same overflow record the browse page uses, so this gallery isn't a lie. */
const OVERFLOW_RUN: Run = {
  id: "r-overflow-demo",
  code: "RUN-4999",
  handle: "ghostwrite",
  goal: "Migrate the entire monorepo from the old build system to the new one, including the seventeen packages nobody has touched since 2023, the two that only build on one specific laptop, and the one that everybody is frightened of, and then delete the old config so nobody can go back",
  status: "live",
  outcome: "running",
  tool: "Claude Code",
  model: "opus-5",
  stacks: ["Next.js", "Python", "Go", "Rust"],
  elapsed: 26400,
  viewers: 921,
  peakViewers: 3300,
  vibe: 12,
  prompts: 402,
  diff: { files: 1204, added: 44210, removed: 51988 },
  tone: 4,
  startedLabel: "7h 20m ago",
};

function Case({
  slate,
  title,
  note,
  demo,
  children,
}: {
  slate: string;
  title: string;
  note: string;
  demo?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-edge-soft pt-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-amber">{slate}</p>
          <h2 className="mt-1 font-display text-xl font-semibold text-bone">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{note}</p>
        </div>
        {demo && (
          <Link
            href={demo}
            className="shrink-0 border border-edge px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-muted uppercase transition-colors hover:border-amber hover:text-amber"
          >
            See it live →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default function StatesPage() {
  const runs = liveRuns();

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
      <SectionHead
        slate="Reference"
        title="Six states a run list has to survive"
        meta="Each one is reachable in the real app"
      />
      <p className="mb-10 max-w-2xl text-[15px] leading-relaxed text-muted">
        A live network spends a lot of its time not being ready. These are the states the
        browse grid ships with, in the order you are most likely to hit them.
      </p>

      <div className="space-y-14">
        <Case
          slate="Success"
          title="Results, as intended"
          note="Cards lead with the goal and the diff stat, so you can tell a refactor from a greenfield build before you click."
          demo="/browse"
        >
          <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {runs.slice(0, 4).map((r) => (
              <RunCard key={r.id} run={r} />
            ))}
          </div>
        </Case>

        <Case
          slate="Loading"
          title="Skeletons that match the real geometry"
          note="The placeholder has the same aspect ratio and the same three metadata lines, so nothing shifts when the data lands."
          demo="/browse?state=loading"
        >
          <RunGridSkeleton count={4} />
        </Case>

        <Case
          slate="Partial / slow"
          title="Half a list is never presented as a whole one"
          note="When part of the wire is late, the count is stated out loud. The results that did arrive stay usable."
          demo="/browse?state=partial"
        >
          <PartialBanner detail="Showing 3 of 8 live runs — the rest of the wire is still catching up." />
          <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {runs.slice(0, 3).map((r) => (
              <RunCard key={r.id} run={r} />
            ))}
          </div>
        </Case>

        <Case
          slate="Empty"
          title="An invitation, not an apology"
          note="Filtered-to-nothing and nothing-on-air are different situations, so they get different copy and different next actions."
          demo="/browse?stack=Solidity&tool=Codex"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <EmptyState
              slate="No runs"
              title="Nobody is on Godot right now"
              body="That is usually a gap, not a dead end. Start the run yourself and you will be the only thing on this page."
              action={{ label: "Clear filters", href: "/browse" }}
            />
            <EmptyState
              slate="No clips"
              title="Nobody has clipped this viber yet"
              body="Clips are cut live by the audience, or automatically when a run ships. Watch a run and take the first one."
              action={{ label: "Browse live runs", href: "/browse" }}
            />
          </div>
        </Case>

        <Case
          slate="Error"
          title="Name the failure, offer the way out"
          note="The error says which subsystem broke and what still works. There is always a second action that does not require the broken thing."
          demo="/browse?state=error"
        >
          <ErrorState
            code="wire/upstream-timeout"
            title="The wire dropped"
            body="Run metadata is served by the wire, and it stopped responding 12 seconds ago. Live video is unaffected — open a run directly and it will still play."
            action={
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/browse"
                  className="bg-amber px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
                >
                  Try again
                </Link>
                <Link
                  href="/watch/nocturne"
                  className="border border-edge px-4 py-2 font-mono text-[11px] tracking-[0.12em] text-bone uppercase transition-colors hover:border-teal hover:text-teal"
                >
                  Open a run anyway
                </Link>
              </div>
            }
          />
        </Case>

        <Case
          slate="Overflow"
          title="Long content clamps, it doesn't break the grid"
          note="Goals are capped at 120 characters at the composer, but imported runs can be longer. Cards clamp to two lines and the run page keeps the whole thing."
          demo="/browse?state=overflow"
        >
          <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            <RunCard run={OVERFLOW_RUN} />
            {runs.slice(0, 3).map((r) => (
              <RunCard key={r.id} run={r} />
            ))}
          </div>
          <p className="mt-4 max-w-2xl font-mono text-[11px] leading-relaxed text-faint">
            Full goal: {OVERFLOW_RUN.goal}
          </p>
        </Case>
      </div>
    </div>
  );
}
