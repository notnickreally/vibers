/**
 * Are the watched channels on air right now? — the sweep.
 *
 * This runs on every sourcing pass, which is every page load of the wall, so
 * what it costs is the whole design. `lib/sourcing.ts` is expensive because
 * `search.list` is a hundred calls a day for every environment at once; this
 * one is deliberately built out of the two things that are *not* scarce:
 *
 * - **YouTube: the channel's RSS feed, then `videos.list`.** The feed is
 *   keyless, free and uncapped, and carries the fifteen newest video ids
 *   including a broadcast that has just started — so it is the candidate leg,
 *   exactly where `search.list` sits in keyword sourcing, at none of the price.
 *   It says nothing at all about liveness, so `videos.list` confirms every id
 *   through `readConfirmed` — the same function, the same `isLive` predicate,
 *   one unit per fifty ids out of ten thousand a day.
 * - **Twitch: one Helix `/streams` call.** Up to a hundred logins per request,
 *   and a login missing from the answer is off air by Helix's own contract.
 *
 * So a wall watching fifty channels costs fifty cached feed reads and about two
 * quota units per sweep, and **zero** of the search budget. That is what makes
 * "check on every visit" affordable at all.
 *
 * Nothing is asserted live that the platform did not confirm. Without
 * `YOUTUBE_API_KEY` the YouTube half finds nothing and says why, rather than
 * trusting a feed entry that would happily list last week's upload as though it
 * were on now; without Twitch credentials the Twitch half does the same. A
 * reason is not a failure — the wall keeps what it has and the panel explains
 * itself, the same bargain `lib/discover.ts` already strikes.
 */

import "server-only";

import { CONFIRM_TTL, readConfirmed } from "./discover";
import type { Metadata } from "./stream";
import { twitchKey, twitchPosterUrl } from "./twitch";
import { credentials, liveStreams, sizeThumbnail } from "./twitch-api";
import {
  FEED_TTL,
  feedUrl,
  readFeedIds,
  type Watched,
  type WatchReason,
  type WatchlistResult,
} from "./watch";
import { chunk, MAX_IDS, parseIds } from "./youtube";

export interface WatchSweep {
  /** The channels confirmed on air, as wall metadata. */
  streams: Metadata[];
  /** The watchlist keys behind them, for `noteLive`. */
  liveKeys: string[];
  result: WatchlistResult;
}

/**
 * One channel's recent video ids, from its feed.
 *
 * A failure is an empty list rather than a throw: one channel's feed being
 * unreachable is fewer streams, not no streams, and a watchlist of fifty must
 * not be taken down by one of them.
 */
async function feedIds(channelId: string): Promise<string[] | null> {
  const url = feedUrl(channelId);
  if (!url) return [];
  try {
    const res = await fetch(url, {
      headers: { accept: "application/atom+xml,text/xml" },
      next: { revalidate: FEED_TTL },
    });
    if (!res.ok) return null;
    return readFeedIds(await res.text());
  } catch {
    return null;
  }
}

/**
 * The YouTube half.
 *
 * Two passes on purpose. The first gathers candidates and remembers which
 * channel each id came from — the feed is the only thing that knows that, and
 * `videos.list` answers about videos, not about who we were asking after. The
 * second confirms them all in one batch, because fifty ids cost the same unit
 * as one.
 */
async function youtubeLive(
  channels: Watched[],
  reasons: Set<WatchReason>,
): Promise<{ streams: Metadata[]; keys: string[] }> {
  if (channels.length === 0) return { streams: [], keys: [] };

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    // The feed would tell us a channel's newest videos and nothing about
    // whether any of them is on right now. Putting one up on that basis would
    // be inventing a fact about someone else's broadcast.
    reasons.add("no-key");
    return { streams: [], keys: [] };
  }

  const owner = new Map<string, string>();
  const candidates: string[] = [];
  for (const channel of channels) {
    const ids = await feedIds(channel.id);
    if (ids === null) {
      reasons.add("upstream");
      continue;
    }
    for (const id of ids) {
      if (!owner.has(id)) owner.set(id, channel.key);
      candidates.push(id);
    }
  }
  if (candidates.length === 0) return { streams: [], keys: [] };

  // The ids came off someone else's feed rather than out of our own hands, and
  // the next thing that happens to them is being interpolated into a Google
  // URL — so they go through the same gate a pasted id would.
  const ids = parseIds(candidates.join(","), candidates.length);
  const streams: Metadata[] = [];
  for (const batch of chunk(ids, MAX_IDS)) {
    const params = new URLSearchParams({
      part: "snippet,liveStreamingDetails",
      id: batch.join(","),
      key,
    });
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
        next: { revalidate: CONFIRM_TTL },
      });
      if (!res.ok) {
        reasons.add("upstream");
        continue;
      }
      // `readConfirmed` keeps only what the video resource itself says is on
      // air — the same gate keyword sourcing goes through, so a stream cannot
      // be judged live by one rule here and another rule there.
      streams.push(...readConfirmed(await res.json()));
    } catch {
      reasons.add("upstream");
    }
  }

  const keys = [...new Set(streams.map((s) => owner.get(s.videoId)).filter(isKey))];
  return { streams, keys };
}

function isKey(value: string | undefined): value is string {
  return typeof value === "string";
}

/**
 * The Twitch half.
 *
 * A live channel *is* addressed by the channel, so there is no candidate leg
 * here at all: the login we stored is already the key the stream lands under.
 * That asymmetry with YouTube is Twitch's, not ours — see `lib/watch.ts`.
 */
async function twitchLive(
  channels: Watched[],
  reasons: Set<WatchReason>,
): Promise<{ streams: Metadata[]; keys: string[] }> {
  if (channels.length === 0) return { streams: [], keys: [] };
  if (!credentials()) {
    reasons.add("no-twitch-credentials");
    return { streams: [], keys: [] };
  }

  const live = await liveStreams(channels.map((c) => c.id));
  // Null is "we were told nothing" — a spent rate limit, a revoked secret, an
  // outage. An empty map is a real answer meaning nobody is on air.
  if (!live) {
    reasons.add("upstream");
    return { streams: [], keys: [] };
  }

  const streams: Metadata[] = [];
  const keys: string[] = [];
  for (const channel of channels) {
    const entry = live.get(channel.id);
    if (!entry) continue;
    const source = { kind: "channel", id: channel.id } as const;
    streams.push({
      videoId: twitchKey(source),
      // The broadcast's own title when Helix gave one, and the channel's name
      // when it did not. Never a made-up sentence about what is on.
      title: entry.title?.trim() || channel.name,
      channel: entry.user_name || channel.name,
      channelUrl: channel.url,
      // Twitch's own frame of the stream, sized — falling back to the live
      // preview URL, which is the channel's current frame and refreshes itself.
      thumbnail: sizeThumbnail(entry.thumbnail_url) ?? twitchPosterUrl(source),
      description: entry.game_name || undefined,
      // Confirmed by `/helix/streams`, which only returns channels that are on.
      isLive: true,
      viewers: entry.viewer_count,
    });
    keys.push(channel.key);
  }
  return { streams, keys };
}

/**
 * Everything the watchlist has on air right now.
 *
 * Both platforms are asked in parallel — they share nothing, and a slow feed on
 * one side should not delay the other. Neither ever throws: the caller folds
 * what came back into the wall and shows the reasons for what did not.
 */
export async function sweepWatchlist(channels: Watched[]): Promise<WatchSweep> {
  const reasons = new Set<WatchReason>();
  if (channels.length === 0) {
    return { streams: [], liveKeys: [], result: { watched: 0, found: 0, reasons: ["empty"] } };
  }

  const [youtube, twitch] = await Promise.all([
    youtubeLive(
      channels.filter((c) => c.provider === "youtube"),
      reasons,
    ),
    twitchLive(
      channels.filter((c) => c.provider === "twitch"),
      reasons,
    ),
  ]);

  const streams = [...youtube.streams, ...twitch.streams];
  return {
    streams,
    liveKeys: [...youtube.keys, ...twitch.keys],
    result: { watched: channels.length, found: streams.length, reasons: [...reasons] },
  };
}
