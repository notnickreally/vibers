import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WatchView } from "@/components/wall/watch-view";
import { parseYouTube } from "@/lib/youtube";

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
      <WatchView videoId={id} />
    </div>
  );
}
