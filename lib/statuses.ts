/**
 * Is it still on air? — for a batch of the wall's keys at once.
 *
 * This is the network leg that `app/api/youtube/status` used to hold inline.
 * It moved out because there are now two callers: that route, still, and the
 * wall's own refresh in `app/api/streams/refresh`, which asks the same
 * question about the shared wall and writes the answer to the database. A
 * route handler is not an importable thing, and two spellings of "is it live"
 * is exactly how a tile ends up flickering between tabs.
 *
 * It now takes **source keys**, not video ids, and splits them by platform:
 * YouTube ids go to `videos.list`, Twitch channels go to Helix, and Twitch VODs
 * and clips are answered without asking anyone — a recording is not a
 * broadcast, and that is knowable without a credential.
 *
 * Batched because it has to be: `videos.list` takes up to 50 ids per call and
 * costs one unit whether you ask about one video or fifty, so refreshing a
 * sixty-tile wall is two units out of a daily ten thousand. Helix takes 100
 * logins per call, so the Twitch side of the same wall is one request.
 *
 * Without a key each side answers `{}` rather than throwing. A wall that cannot
 * refresh should keep what it already knows, not lose it.
 */

import "server-only";

import { parseKey } from "./source";
import type { Status } from "./stream";
import type { TwitchSource } from "./twitch";
import { twitchKey } from "./twitch";
import { liveStreams } from "./twitch-api";
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

async function youtubeStatuses(ids: string[]): Promise<Record<string, Status>> {
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

/**
 * The Twitch half.
 *
 * Two things here are the opposite of the YouTube branch above, and both follow
 * from what Twitch's API actually says:
 *
 * - **A missing login means off air.** `/helix/streams` returns one row per
 *   channel that is live and says nothing about the rest, so absence is a
 *   confirmed `false` here — where on the YouTube side the same absence means
 *   "we were told nothing" and the tile must be left alone.
 * - **A VOD or a clip is answered with no request at all.** It is a recording;
 *   it was never on air and never will be. Asking Twitch to confirm that would
 *   spend a request to learn something the key already says.
 *
 * With no credentials the channels are dropped rather than reported off air.
 * Guessing "not live" would file every live Twitch tile under Ended, which is
 * the same mistake `shelf()` documents on the YouTube side.
 */
async function twitchStatuses(sources: TwitchSource[]): Promise<Record<string, Status>> {
  const statuses: Record<string, Status> = {};
  const logins: string[] = [];

  for (const source of sources) {
    if (source.kind === "channel") logins.push(source.id);
    else statuses[twitchKey(source)] = { isLive: false };
  }
  if (logins.length === 0) return statuses;

  const live = await liveStreams(logins);
  // Null is "we were told nothing" — no credentials, a spent rate limit, an
  // outage — and it leaves every channel exactly as it was. An empty map is a
  // real answer meaning nobody is on air.
  if (!live) return statuses;

  for (const login of logins) {
    const entry = live.get(login);
    statuses[twitchKey({ kind: "channel", id: login })] = {
      isLive: Boolean(entry),
      viewers: entry?.viewer_count,
    };
  }
  return statuses;
}

/** What every key on the wall is doing right now, keyed by that same key. */
export async function fetchStatuses(keys: string[]): Promise<Record<string, Status>> {
  const youtube: string[] = [];
  const twitch: TwitchSource[] = [];

  for (const key of keys) {
    const source = parseKey(key);
    if (!source) continue;
    if (source.provider === "twitch") twitch.push(source);
    else youtube.push(source.id);
  }

  const [yt, tw] = await Promise.all([youtubeStatuses(youtube), twitchStatuses(twitch)]);
  return { ...yt, ...tw };
}
