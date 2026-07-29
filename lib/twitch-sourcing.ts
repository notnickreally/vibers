/**
 * Go and find live Twitch streams, by category.
 *
 * The fetching half of `lib/twitch-discover.ts` — the same split
 * `lib/sourcing.ts` and `lib/discover.ts` already make, and for the same reason:
 * the decisions live in pure functions the suite can run, and this file does the
 * two round trips and nothing else.
 *
 * Two legs, and unlike the YouTube side neither of them is a confirmation:
 *
 * - **`/helix/games?name=`** turns the configured category names into ids. Cached
 *   hard, because a Twitch category's id does not change — "Software and Game
 *   Development" will have the same id next week.
 * - **`/helix/streams?game_id=…`** is the whole answer. Every row it returns is a
 *   channel that is on air, by Helix's contract, so there is no second call to
 *   make. That is the one place Twitch is genuinely easier than YouTube, where
 *   `eventType=live` is a search index whose word means nothing and
 *   `videos.list` has to be asked separately.
 *
 * So a run costs **two requests cold and one warm**, against a bucket of 800 a
 * minute. Compare the YouTube leg, which spends a keyword each out of a hundred
 * a day for every environment at once. Nothing here needs a quota latch, and the
 * absence of one is not an oversight — see `TwitchReason` in `lib/discover.ts`.
 *
 * Off unless `TWITCH_DISCOVER_ENABLED` is set. Not for a budget's sake this
 * time, but so that turning sourcing on stays one deliberate act per
 * environment on both platforms rather than one platform's flag quietly
 * enabling the other's.
 */

import "server-only";

import { type DiscoverLeg, leg, type TwitchReason } from "./discover";
import type { Metadata } from "./stream";
import { credentials, helix } from "./twitch-api";
import {
  MAX_TWITCH_CATEGORIES,
  readGames,
  readLiveStreams,
  resolveCategories,
  TWITCH_DISCOVER_TTL,
  TWITCH_PAGE,
} from "./twitch-discover";

export interface TwitchDiscovery {
  streams: Metadata[];
  leg: DiscoverLeg<TwitchReason>;
}

/**
 * The floor under the cache, and here it is the *only* cache.
 *
 * `helix()` sends `cache: "no-store"` on every request — deliberately, because
 * its other callers are asking whether a channel is on air this second and a
 * cached answer to that is a wrong answer. So unlike `lib/sourcing.ts`, which
 * has Next's Data Cache underneath its memo, this module has nothing but the
 * memo. That makes it load-bearing rather than a belt-and-braces guard: without
 * it every page load would spend a request per visitor.
 */
let memo: { at: number; result: TwitchDiscovery } | null = null;

/**
 * Category ids, kept far longer than a discovery run.
 *
 * Keyed by the resolved name list, so changing `TWITCH_DISCOVER_CATEGORIES`
 * invalidates it rather than serving yesterday's ids for today's names. A day is
 * arbitrary and generous on purpose: these ids are effectively permanent, and
 * the failure mode of a stale one is a category that stops returning streams,
 * which the next day's refresh fixes on its own.
 */
const GAMES_TTL_MS = 24 * 60 * 60 * 1000;
let games: { at: number; key: string; ids: string[] } | null = null;

/**
 * The `game_id`s for a list of category names — or null if Twitch didn't answer.
 *
 * The two empty answers are kept apart, and that distinction is the whole reason
 * this leg addresses categories by name at all: **null** is a request that
 * failed, and an **empty array** is Twitch telling us it has never heard of any
 * of these names. The first is worth retrying and the second is a typo in the
 * deployment's configuration, and a caller that could not tell them apart would
 * report a misspelled category as an outage forever.
 */
async function gameIds(names: string[], now: number): Promise<string[] | null> {
  const key = names.join("|");
  if (games && games.key === key && now - games.at < GAMES_TTL_MS) return games.ids;

  const params = new URLSearchParams();
  for (const name of names.slice(0, MAX_TWITCH_CATEGORIES)) params.append("name", name);
  const json = await helix<unknown>("games", params);
  if (!json) return null;

  const ids = readGames(json).map((game) => game.id);
  // Only a real answer is cached. Caching a failure would be caching an outage.
  games = { at: now, key, ids };
  return ids;
}

/**
 * The live streams in the configured categories.
 *
 * Every path answers with a leg and a reason rather than throwing, the same
 * bargain the YouTube side strikes: a wall that cannot discover should keep what
 * it already has and be told why, not be handed an error to render.
 */
export async function discoverTwitch(now: number): Promise<TwitchDiscovery> {
  if (!process.env.TWITCH_DISCOVER_ENABLED) return { streams: [], leg: leg([], "off") };

  const categories = resolveCategories(process.env.TWITCH_DISCOVER_CATEGORIES);
  if (!credentials()) return { streams: [], leg: leg(categories, "no-credentials") };
  // An all-junk category list is the same dead end as one Twitch doesn't know.
  if (categories.length === 0) return { streams: [], leg: leg(categories, "no-category") };

  if (memo && now - memo.at < TWITCH_DISCOVER_TTL * 1000) return memo.result;

  const ids = await gameIds(categories, now);
  if (!ids) return { streams: [], leg: leg(categories, "upstream") };
  if (ids.length === 0) return { streams: [], leg: leg(categories, "no-category") };

  const params = new URLSearchParams();
  for (const id of ids) params.append("game_id", id);
  params.set("first", String(TWITCH_PAGE));
  const json = await helix<unknown>("streams", params);
  if (!json) return { streams: [], leg: leg(categories, "upstream") };

  const streams = readLiveStreams(json);
  const result: TwitchDiscovery = {
    streams,
    leg: { asked: categories, found: streams.length },
  };
  // Only a successful run is memoised, so a failed one is retried on the next
  // visit rather than being repeated back for two minutes.
  memo = { at: now, result };
  return result;
}
