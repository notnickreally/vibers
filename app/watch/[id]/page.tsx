import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WatchView } from "@/components/wall/watch-view";
import { parseYouTube, posterUrl } from "@/lib/youtube";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  return {
    title: "Watching",
    description: `A YouTube stream playing on vibers.tv (${id}).`,
  };
}

export default async function WatchPage({ params }: { params: Params }) {
  const { id } = await params;
  // The segment is the video id itself, so a malformed one is a 404 rather
  // than a player pointed at nothing.
  if (!parseYouTube(id)) notFound();

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      {/* The poster stands in for the picture until there is one, so it is the
          largest thing on this page at first paint. Asking for it here — in
          the server-rendered markup, where the id is already known — starts
          it before hydration, rather than after the player mounts. */}
      <link rel="preload" as="image" href={posterUrl(id)} fetchPriority="high" />
      <WatchView videoId={id} />
    </div>
  );
}
