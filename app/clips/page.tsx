import type { Metadata } from "next";
import Link from "next/link";
import { ClipCard } from "@/components/stream/clip-card";
import { EmptyState } from "@/components/states";
import { SectionHead } from "@/components/ui/bits";
import { compact } from "@/lib/format";
import { CLIPS } from "@/lib/mock/data";
import type { Clip } from "@/lib/mock/types";

export const metadata: Metadata = {
  title: "Clips",
  description: "Ship moments, chat rescues, rabbit holes and one-shots, cut from live runs.",
};

const KINDS: { key: Clip["kind"] | "all"; label: string; blurb: string }[] = [
  { key: "all", label: "Everything", blurb: "Every clip cut this week" },
  { key: "ship", label: "Ship moments", blurb: "The build went green on camera" },
  { key: "rescue", label: "Chat rescues", blurb: "The audience found it first" },
  { key: "rabbit-hole", label: "Rabbit holes", blurb: "Hours against one stack trace" },
  { key: "one-shot", label: "One-shots", blurb: "One prompt, no follow-ups" },
];

export default async function ClipsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind = "all" } = await searchParams;
  const clips = kind === "all" ? CLIPS : CLIPS.filter((c) => c.kind === kind);
  const views = clips.reduce((n, c) => n + c.views, 0);
  const active = KINDS.find((k) => k.key === kind) ?? KINDS[0];

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
      <SectionHead
        slate="Clips"
        title={active.label}
        meta={clips.length ? `${clips.length} clips · ${compact(views)} views` : undefined}
      />

      <div className="mb-8 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <Link
            key={k.key}
            href={k.key === "all" ? "/clips" : `/clips?kind=${k.key}`}
            className={`border px-3 py-1.5 font-mono text-[11px] transition-colors ${
              kind === k.key
                ? "border-amber bg-amber/12 text-amber"
                : "border-edge-soft text-muted hover:border-edge hover:text-bone"
            }`}
          >
            {k.label}
          </Link>
        ))}
      </div>

      <p className="mb-8 max-w-xl text-sm leading-relaxed text-muted">{active.blurb}.</p>

      {clips.length === 0 ? (
        <EmptyState
          slate="No clips"
          title={`No ${active.label.toLowerCase()} this week`}
          body="Clips are cut by the audience during a run, or automatically the moment a build goes green. Watch something live and take the first one."
          action={{ label: "Browse live runs", href: "/browse" }}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {clips.map((c) => (
            <ClipCard key={c.id} clip={c} />
          ))}
        </div>
      )}
    </div>
  );
}
