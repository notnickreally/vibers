import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WatchView } from "@/components/wall/watch-view";
import { decodeKeySegment, parseKey, posterFor, PROVIDER_LABEL, sourceNoun } from "@/lib/source";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const key = decodeKeySegment(id);
  const source = key ? parseKey(key) : null;
  return {
    title: "Watching",
    description: source
      ? `A ${PROVIDER_LABEL[source.provider]} ${sourceNoun(source)} playing on vibers.tv (${key}).`
      : `A stream playing on vibers.tv (${key ?? id}).`,
  };
}

export default async function WatchPage({ params }: { params: Params }) {
  const { id } = await params;
  // The segment arrives percent-encoded — Next hands it over exactly as the URL
  // spells it — so it is decoded before anything reads it. What comes out is the
  // stream's own key: a bare YouTube video id, or a prefixed Twitch one. A
  // malformed one is a 404 rather than a player pointed at nothing.
  const key = decodeKeySegment(id);
  const source = key ? parseKey(key) : null;
  if (!key || !source) notFound();

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      {/* The poster stands in for the picture until there is one, so it is the
          largest thing on this page at first paint. Asking for it here — in
          the server-rendered markup, where the key is already known — starts
          it before hydration, rather than after the player mounts. */}
      <link rel="preload" as="image" href={posterFor(source)} fetchPriority="high" />
      <WatchView videoId={key} />
    </div>
  );
}
