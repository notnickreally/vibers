import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RelayPlayer } from "@/components/stream/relay-player";
import { RunCard } from "@/components/stream/run-card";
import { SectionHead } from "@/components/ui/bits";
import { relayFromParams } from "@/lib/relay";
import { liveRuns } from "@/lib/mock/data";
import { parseYouTube } from "@/lib/youtube";

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  return {
    title: "Relayed stream",
    description: `A YouTube stream carried on vibers.tv (${id}).`,
  };
}

export default async function RelayWatchPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { id } = await params;
  const search = await searchParams;

  // The path segment is the video id itself, so a bad one is a 404 rather than
  // an iframe pointed at nothing.
  if (!parseYouTube(id)) notFound();
  const relay = relayFromParams(id, search);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <RelayPlayer relay={relay} />
        </div>

        <aside className="space-y-6">
          <div className="border border-edge-soft bg-panel p-4">
            <p className="eyebrow">What a relay is</p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Someone on vibers.tv pointed the network at this stream. The creator
              didn&apos;t post it here and hasn&apos;t claimed anything about it — which is
              why this page carries no goal, no prompts and no stats.
            </p>
            <Link
              href="/relay"
              className="mt-4 block border border-edge px-3 py-2 text-center font-mono text-[10px] tracking-[0.12em] text-muted uppercase transition-colors hover:border-amber hover:text-amber"
            >
              Relay another stream
            </Link>
          </div>

          <div className="border border-edge-soft bg-panel p-4">
            <p className="eyebrow">Are you the creator?</p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              You can have this removed, or claim it and turn it into a real run with your
              own goal and Prompt-Cam.
            </p>
            <div className="mt-4 grid gap-2">
              <Link
                href={`/report?v=${id}`}
                className="border border-edge px-3 py-2 text-center font-mono text-[10px] tracking-[0.12em] text-muted uppercase transition-colors hover:border-del hover:text-del"
              >
                Take it down
              </Link>
              <Link
                href={`/go-live?v=${id}`}
                className="border border-edge px-3 py-2 text-center font-mono text-[10px] tracking-[0.12em] text-teal uppercase transition-colors hover:border-teal"
              >
                Claim as a run
              </Link>
            </div>
          </div>
        </aside>
      </div>

      <section className="mt-14">
        <SectionHead
          slate="Meanwhile"
          title="Runs happening on vibers.tv"
          meta="Declared goals, live prompts"
        />
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {liveRuns()
            .slice(0, 4)
            .map((r) => (
              <RunCard key={r.id} run={r} compactMode />
            ))}
        </div>
      </section>
    </div>
  );
}
