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
 *
 * This used to live inside `app/api/youtube`. It moved because the wall is now
 * shared, and that changes who is allowed to say what a stream *is*: when the
 * wall lived in your own browser, a title arriving from the client could only
 * ever mislead you. Now it would go on everyone's wall — an arbitrary string
 * under an arbitrary `img src`, from anyone who can reach the route. So
 * `app/api/streams` takes an id and nothing else, and asks YouTube itself.
 * Same promise as before, now load-bearing: nothing on vibers.tv is invented
 * about a stream or its creator.
 */

import "server-only";

import type { Metadata } from "./stream";
import { isLive } from "./youtube";

export interface Looked extends Metadata {
  publishedAt?: string;
}

/** A lookup that failed in a way the caller should report verbatim. */
export class LookupError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LookupError";
    this.status = status;
  }
}

async function fromOEmbed(id: string): Promise<Looked | null> {
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

async function enrich(meta: Looked, key: string): Promise<Looked> {
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

/** Everything YouTube will tell us about one video id. Throws `LookupError`. */
export async function lookupVideo(id: string): Promise<Looked> {
  let meta: Looked | null;
  try {
    meta = await fromOEmbed(id);
  } catch {
    throw new LookupError("Couldn't reach YouTube. Check the connection and try again.", 502);
  }
  if (!meta) throw new LookupError("No such video, or it isn't embeddable.", 404);

  const key = process.env.YOUTUBE_API_KEY;
  return key ? enrich(meta, key) : meta;
}
