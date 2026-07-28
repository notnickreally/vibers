/**
 * Is it still on air? — for a batch of ids at once.
 *
 * This is the network leg that `app/api/youtube/status` used to hold inline.
 * It moved out because there are now two callers: that route, still, and the
 * wall's own refresh in `app/api/streams/refresh`, which asks the same
 * question about the shared wall and writes the answer to the database. A
 * route handler is not an importable thing, and two spellings of "is it live"
 * is exactly how a tile ends up flickering between tabs.
 *
 * Batched because it has to be: `videos.list` takes up to 50 ids per call and
 * costs one unit whether you ask about one video or fifty, so refreshing a
 * sixty-tile wall is two units out of a daily ten thousand.
 *
 * Without a key this answers `{}` rather than throwing. A wall that cannot
 * refresh should keep what it already knows, not lose it.
 */

import "server-only";

import type { Status } from "./stream";
import { chunk, isLive, MAX_IDS } from "./youtube";

interface Item {
  id?: string;
  snippet?: { liveBroadcastContent?: string };
  liveStreamingDetails?: {
    concurrentViewers?: string;
    actualStartTime?: string;
    actualEndTime?: string;
  };
}

export async function fetchStatuses(ids: string[]): Promise<Record<string, Status>> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || ids.length === 0) return {};

  const statuses: Record<string, Status> = {};
  for (const batch of chunk(ids, MAX_IDS)) {
    const url =
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=snippet,liveStreamingDetails&id=${batch.join(",")}&key=${key}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = (await res.json()) as { items?: Item[] };
      for (const item of data.items ?? []) {
        if (!item.id) continue;
        // The shared predicate, so a stream auto-sourcing confirmed live a
        // moment ago cannot be re-judged here by a different rule.
        const live = isLive(item);
        const viewers = item.liveStreamingDetails?.concurrentViewers;
        statuses[item.id] = {
          isLive: live,
          viewers: live && viewers ? Number(viewers) : undefined,
          endedAt: item.liveStreamingDetails?.actualEndTime,
        };
      }
    } catch {
      // One batch failing is a shorter answer, not no answer. Ids that came
      // back with nothing — deleted, privated, never real — are simply absent,
      // and every caller leaves those tiles alone.
    }
  }
  return statuses;
}
