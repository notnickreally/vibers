import type { Metadata } from "next";
import Link from "next/link";
import { RunCard } from "@/components/stream/run-card";
import { EmptyState, ErrorState, PartialBanner, RunGridSkeleton } from "@/components/states";
import { SectionHead } from "@/components/ui/bits";
import { compact } from "@/lib/format";
import { RUNS, STACK_RAIL } from "@/lib/mock/data";
import type { Run, Stack, Tool } from "@/lib/mock/types";

export const metadata: Metadata = {
  title: "Live runs",
  description: "Every run on air right now, filed by stack and tool.",
};

const TOOLS: Tool[] = ["Claude Code", "Cursor", "Codex", "Zed", "Windsurf"];
const SORTS = [
  { key: "viewers", label: "Most watched" },
  { key: "fresh", label: "Just started" },
  { key: "grind", label: "Deepest in it" },
  { key: "diff", label: "Biggest diff" },
];

/**
 * A run whose goal was written by someone with no self-control. It exists so
 * the overflow state is a real record in the list, not a mockup of one.
 */
const OVERFLOW_RUN: Run = {
  id: "r-overflow",
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

function sortRuns(runs: Run[], sort: string): Run[] {
  const copy = [...runs];
  switch (sort) {
    case "fresh":
      return copy.sort((a, b) => a.elapsed - b.elapsed);
    case "grind":
      return copy.sort((a, b) => b.prompts - a.prompts);
    case "diff":
      return copy.sort(
        (a, b) => b.diff.added + b.diff.removed - (a.diff.added + a.diff.removed),
      );
    default:
      return copy.sort((a, b) => b.viewers - a.viewers);
  }
}

function buildHref(params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/browse?${s}` : "/browse";
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ stack?: string; tool?: string; sort?: string; state?: string }>;
}) {
  const { stack, tool, sort = "viewers", state } = await searchParams;

  // `state` forces a demo state. Everything else is real filtering over the
  // fixture set — the empty state is reachable without it.
  if (state === "error") {
    return (
      <Shell stack={stack} tool={tool} sort={sort}>
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
      </Shell>
    );
  }

  if (state === "loading") {
    return (
      <Shell stack={stack} tool={tool} sort={sort}>
        <RunGridSkeleton />
      </Shell>
    );
  }

  const pool = state === "overflow" ? [OVERFLOW_RUN, ...RUNS] : RUNS;
  let runs = pool.filter((r) => r.status === "live");
  if (stack) runs = runs.filter((r) => r.stacks.includes(stack as Stack));
  if (tool) runs = runs.filter((r) => r.tool === tool);
  if (state === "empty") runs = [];
  if (state === "partial") runs = runs.slice(0, 3);
  runs = sortRuns(runs, sort);

  const watching = runs.reduce((n, r) => n + r.viewers, 0);

  return (
    <Shell stack={stack} tool={tool} sort={sort} meta={`${runs.length} live · ${compact(watching)} watching`}>
      {state === "partial" && (
        <PartialBanner detail="Showing 3 of 8 live runs — the rest of the wire is still catching up." />
      )}

      {runs.length === 0 ? (
        <EmptyState
          slate="No runs"
          title={
            stack || tool
              ? `Nobody is on ${stack ?? tool} right now`
              : "Nothing is on air right now"
          }
          body={
            stack || tool
              ? "That is usually a gap, not a dead end. Start the run yourself and you will be the only thing on this page."
              : "Rare, and it never lasts. Browse the clips in the meantime, or take the slot."
          }
          action={
            stack || tool
              ? { label: "Clear filters", href: "/browse" }
              : { label: "Go live", href: "/go-live" }
          }
        />
      ) : (
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </Shell>
  );
}

function Shell({
  children,
  stack,
  tool,
  sort,
  meta,
}: {
  children: React.ReactNode;
  stack?: string;
  tool?: string;
  sort: string;
  meta?: string;
}) {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
      <SectionHead
        slate="Browse"
        title="Live runs"
        meta={meta}
        action={
          <Link
            href="/states"
            className="font-mono text-[11px] tracking-[0.1em] text-faint uppercase transition-colors hover:text-bone"
          >
            UI states →
          </Link>
        }
      />

      <div className="mb-8 space-y-3">
        <FilterRow label="Stack" active={stack}>
          <FilterPill href={buildHref({ tool, sort })} active={!stack}>
            All
          </FilterPill>
          {STACK_RAIL.map((s) => (
            <FilterPill
              key={s.label}
              href={buildHref({ stack: s.label, tool, sort })}
              active={stack === s.label}
              hue={s.hue}
            >
              {s.label}
            </FilterPill>
          ))}
        </FilterRow>

        <FilterRow label="Tool" active={tool}>
          <FilterPill href={buildHref({ stack, sort })} active={!tool}>
            All
          </FilterPill>
          {TOOLS.map((t) => (
            <FilterPill key={t} href={buildHref({ stack, tool: t, sort })} active={tool === t}>
              {t}
            </FilterPill>
          ))}
        </FilterRow>

        <FilterRow label="Sort">
          {SORTS.map((s) => (
            <FilterPill
              key={s.key}
              href={buildHref({ stack, tool, sort: s.key })}
              active={sort === s.key}
            >
              {s.label}
            </FilterPill>
          ))}
        </FilterRow>
      </div>

      {children}
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  active?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-12 shrink-0 font-mono text-[10px] tracking-[0.16em] text-faint uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

function FilterPill({
  href,
  active,
  hue,
  children,
}: {
  href: string;
  active: boolean;
  hue?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`border px-2.5 py-1 font-mono text-[11px] transition-colors ${
        active
          ? "border-amber bg-amber/12 text-amber"
          : "border-edge-soft text-muted hover:border-edge hover:text-bone"
      }`}
      style={!active && hue !== undefined ? { color: `hsl(${hue} 45% 62%)` } : undefined}
    >
      {children}
    </Link>
  );
}
