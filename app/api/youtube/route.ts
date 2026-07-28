import { NextResponse } from "next/server";
import { isLive, parseYouTube } from "@/lib/youtube";

/**
 * Look up a video's real metadata.
 *
 * Two sources, in order of what's available:
 *
 * - **oEmbed** — no key, no quota, always on. Gives the title, the channel and
 *   a thumbnail. This is what makes the app work out of the box.
 * - **YouTube Data API** — only if `YOUTUBE_API_KEY` is set. Adds the
 *   description, whether the stream is actually live, and the concurrent
 *   viewer count.
 *
 * Anything we can't establish stays undefined rather than being guessed. A
 * stream is only labelled live when the API said so.
 */

export const revalidate = 0;

interface Metadata {
  videoId: string;
  title: string;
  channel: string;
  channelUrl?: string;
  thumbnail: string;
  description?: string;
  isLive?: boolean;
  viewers?: number;
  /** When the broadcast ended. Only ever present on something that was live. */
  endedAt?: string;
  publishedAt?: string;
}

async function fromOEmbed(id: string): Promise<Metadata | null> {
  const target = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${id}`,
  )}&format=json`;

  // A video's title, channel and thumbnail do not change minute to minute, so
  // this leg is cached — it is pure latency on the way to painting the page.
  // `enrich` below is deliberately left uncached: concurrent viewers and
  // whether a stream is still live are exactly the things that must be true
  // right now, and the route stays dynamic for them.
  const res = await fetch(target, {
    headers: { accept: "application/json" },
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    title?: string;
    author_name?: string;
    author_url?: string;
    thumbnail_url?: string;
  };

  if (!data.title) return null;
  return {
    videoId: id,
    title: data.title,
    channel: data.author_name ?? "Unknown channel",
    channelUrl: data.author_url,
    thumbnail: data.thumbnail_url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

async function enrich(meta: Metadata, key: string): Promise<Metadata> {
  const url =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,liveStreamingDetails&id=${meta.videoId}&key=${key}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return meta;
    const data = (await res.json()) as {
      items?: {
        snippet?: {
          description?: string;
          liveBroadcastContent?: string;
          publishedAt?: string;
        };
        liveStreamingDetails?: {
          concurrentViewers?: string;
          actualStartTime?: string;
          actualEndTime?: string;
        };
      }[];
    };
    const item = data.items?.[0];
    if (!item) return meta;

    // One predicate, shared with `/status` and with auto-sourcing. Three
    // spellings of "is it live" is how a tile ends up flickering between tabs.
    const live = isLive(item);
    const viewers = item.liveStreamingDetails?.concurrentViewers;

    return {
      ...meta,
      description: item.snippet?.description || undefined,
      publishedAt: item.snippet?.publishedAt,
      isLive: live,
      viewers: viewers ? Number(viewers) : undefined,
      endedAt: item.liveStreamingDetails?.actualEndTime,
    };
  } catch {
    // The key is optional; a failed enrichment must never break the lookup.
    return meta;
  }
}

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("v");
  if (!input) {
    return NextResponse.json({ error: "Pass a YouTube URL or id as ?v=" }, { status: 400 });
  }

  const source = parseYouTube(input);
  if (!source) {
    return NextResponse.json({ error: "That isn't a YouTube link." }, { status: 400 });
  }

  let meta: Metadata | null;
  try {
    meta = await fromOEmbed(source.id);
  } catch {
    return NextResponse.json(
      { error: "Couldn't reach YouTube. Check the connection and try again." },
      { status: 502 },
    );
  }

  if (!meta) {
    return NextResponse.json(
      { error: "No such video, or it isn't embeddable." },
      { status: 404 },
    );
  }

  const key = process.env.YOUTUBE_API_KEY;
  if (key) meta = await enrich(meta, key);

  return NextResponse.json(meta);
}
