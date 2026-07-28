/**
 * Auto-sourcing: the wall goes and finds live coding streams itself.
 *
 * Everything here is pure. The route in `app/api/youtube/discover` does the
 * fetching and nothing else, because the one thing this repo cannot test is a
 * route — the suite runs in vitest's default node environment with no mocks, so
 * a decision only gets pinned if it lives in a function like these.
 *
 * ## The number that shapes the whole design
 *
 * `search.list` is capped at **100 calls a day per Google Cloud project**. Not
 * per deployment — per *project*, which is to say per key. Production, a preview
 * deployment and someone running `pnpm dev` all read the same
 * `YOUTUBE_API_KEY` and spend the same hundred, while each keeps its own cache.
 * The quota is free and cannot be bought; it resets at midnight Pacific.
 *
 * So the budget here is deliberately half of it, and the cache TTL is *derived*
 * from the budget rather than picked and hoped for:
 *
 *     DISCOVER_TTL = 86400 × MAX_KEYWORDS / SEARCH_BUDGET
 *
 * which makes `MAX_KEYWORDS × 86400 / DISCOVER_TTL ≤ SEARCH_BUDGET` true by
 * construction. Pick the two numbers by hand and they drift apart the first time
 * someone adds a keyword; this way adding one lengthens the TTL instead of
 * quietly overspending. `videos.list` is a different bucket entirely — one unit
 * per fifty ids out of ten thousand a day — which is why confirming is cheap
 * enough to do every time and searching is not.
 */

import type { Metadata, Stream } from "./stream";
import { isLive, isVideoId, posterFallbackUrl, type VideoItem } from "./youtube";

/** Half of `search.list`'s 100/day. The other half is everyone else's mistakes. */
export const SEARCH_BUDGET = 50;

export const MAX_KEYWORDS = 4;

/** Seconds. Derived, not chosen — see the note above. */
export const DISCOVER_TTL = Math.ceil((86_400 * MAX_KEYWORDS) / SEARCH_BUDGET);

/**
 * Seconds the *confirmation* leg is cached for.
 *
 * Short, and that asymmetry is the point: the candidate set may be two hours
 * stale, but whether each candidate is still on air is re-asked every minute.
 * A stream that ended in the meantime is filtered out before it reaches the
 * wall, so staleness costs recall and never correctness.
 */
export const CONFIRM_TTL = 60;

export const MAX_PER_KEYWORD = 25;

export const MAX_CANDIDATES = MAX_KEYWORDS * MAX_PER_KEYWORD;

/**
 * How many sourced streams the wall will hold.
 *
 * The wall opens in monitors mode, so every one of these is an autoplaying
 * embed on a page nobody asked to be filled. Twelve is roughly what someone
 * curating by hand ends up with, and at a three-wide grid about half are on
 * screen; the rest wait for `loading="lazy"`.
 */
export const MAX_SOURCED = 12;

/**
 * How long a sourced stream may sit on the wall before it is swept.
 *
 * YouTube's developer policies cap storage of un-authorized API data at thirty
 * days, so that is a ceiling rather than a target. A day is the honest number
 * for something whose entire claim is that it is live right now — and a sweep
 * that happens on its own is a retention policy, where a button someone might
 * press is not.
 */
export const SOURCED_TTL_MS = 24 * 60 * 60 * 1000;

/** Ids the viber has thrown off the wall. Capped so the key can't grow forever. */
export const MAX_DISMISSED = 200;

/**
 * What the wall looks for when nobody has said otherwise.
 *
 * Seeds rather than a fixed list: `YOUTUBE_DISCOVER_KEYWORDS` replaces these at
 * deploy time. What there is deliberately *no* path for is a keyword arriving
 * from the browser — see `resolveKeywords`.
 */
export const SEED_KEYWORDS = [
  "vibecoding live",
  "using claude code",
  "claude code live",
  "live coding",
];

/** Why there is nothing to show, when there is nothing to show. */
export type Reason = "off" | "no-key" | "quota" | "upstream";

export interface DiscoverResult {
  keywords: string[];
  streams: Metadata[];
  reason?: Reason;
}

/**
 * A keyword we are willing to hand to Google, or null.
 *
 * This is a security control rather than tidying. The keyword is interpolated
 * into an upstream query, so the charset is an allowlist and anything outside
 * it fails the whole keyword rather than being escaped into it — the same
 * discipline `parseIds` applies to video ids. It runs over the environment
 * variable too: an operator is a trusted person, not a trusted encoder.
 *
 * Lowercased because YouTube's search is case-insensitive, so folding case
 * loses nothing and makes the dedupe below actually catch duplicates.
 */
const KEYWORD = /^[a-z0-9 '&+#.-]+$/;

export function sanitizeKeyword(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const keyword = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (keyword.length < 2 || keyword.length > 64) return null;
  return KEYWORD.test(keyword) ? keyword : null;
}

/**
 * The keyword list, from the environment or the seeds.
 *
 * There is no caller-supplied variant of this on purpose. A `?q=` on the route
 * would let any visitor spend a scarce, un-buyable, site-wide resource — a
 * hundred requests with a hundred different words is the whole day, gone, and
 * it costs the sender nothing. So the list is the operator's, the cap is
 * `MAX_KEYWORDS` because the TTL is derived from it, and the browser's only
 * freedom is which of the *already-fetched* keywords it shows.
 */
export function resolveKeywords(env: string | undefined): string[] {
  const source = env?.trim() ? env.split(",") : SEED_KEYWORDS;
  const out: string[] = [];
  for (const raw of source) {
    const keyword = sanitizeKeyword(raw);
    if (!keyword || out.includes(keyword)) continue;
    out.push(keyword);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

/**
 * Video ids out of a `search.list` response.
 *
 * Total over junk, because this is upstream-shaped data rather than data we
 * shaped: a response missing `items`, an item missing `id`, an id that is not
 * an id. Every one of those is an entry we skip, not a throw — and the ids go
 * through `isVideoId` before they are ever handed back, because the next thing
 * that happens to them is being interpolated into another Google URL.
 */
export function readCandidates(json: unknown): string[] {
  const items = (json as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const out: string[] = [];
  for (const item of items) {
    const id = (item as { id?: { videoId?: unknown } })?.id?.videoId;
    if (typeof id !== "string" || !isVideoId(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/** YouTube's channel ids. Anything else and we simply don't link the channel. */
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

interface ConfirmItem extends VideoItem {
  snippet?: {
    liveBroadcastContent?: string;
    title?: string;
    channelTitle?: string;
    channelId?: string;
    description?: string;
  };
  liveStreamingDetails?: {
    actualStartTime?: string;
    actualEndTime?: string;
    concurrentViewers?: string;
  };
}

/**
 * The candidates that are genuinely on air, as wall metadata.
 *
 * This is the step that makes the feature's one hard promise true. `eventType=live`
 * is a query against a search index, and the index carries no freshness
 * guarantee; worse, `snippet.liveBroadcastContent` *inside* an `eventType=live`
 * result set is self-confirming — it reads "live" because "live" is what was
 * asked for, so checking it there proves nothing. The video resource is the only
 * thing that actually knows, and asking it costs a single quota unit for fifty
 * videos. So nothing reaches the wall on the search index's word alone.
 *
 * Matched **by id, never by array position**: ids that are deleted, private or
 * simply never real come back absent rather than null, so the response is
 * shorter than the request and position-matching would attach one stream's
 * title to another stream's id.
 *
 * The thumbnail is rebuilt from the id rather than read from the response —
 * `mqdefault`, the 16:9 variant that always exists, because a URL that arrives
 * over the wire is one more string we would be putting in an `img src` on the
 * strength of where it claimed to come from.
 */
export function readConfirmed(json: unknown): Metadata[] {
  const items = (json as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const byId = new Map<string, Metadata>();
  for (const raw of items) {
    const item = raw as ConfirmItem;
    const id = item?.id;
    if (typeof id !== "string" || !isVideoId(id) || byId.has(id)) continue;
    if (!isLive(item)) continue;

    const title = item.snippet?.title;
    // Nothing goes on the wall without a real title. A tile that says nothing
    // about what it is playing is worse than one fewer tile.
    if (typeof title !== "string" || !title.trim()) continue;

    const channelId = item.snippet?.channelId;
    const viewers = Number(item.liveStreamingDetails?.concurrentViewers);

    byId.set(id, {
      videoId: id,
      title,
      channel: item.snippet?.channelTitle || "Unknown channel",
      channelUrl:
        typeof channelId === "string" && CHANNEL_ID.test(channelId)
          ? `https://www.youtube.com/channel/${channelId}`
          : undefined,
      thumbnail: posterFallbackUrl(id),
      description: item.snippet?.description || undefined,
      // Confirmed, by the resource, one line above.
      isLive: true,
      // Absent when the broadcast has no current viewers or the owner hid the
      // count — which is not the same as zero, so it stays undefined.
      viewers: Number.isFinite(viewers) && viewers >= 0 ? viewers : undefined,
    });
  }
  return [...byId.values()];
}

/**
 * Why an upstream call came back empty — never Google's own wording.
 *
 * The `message` field on a quota error carries raw HTML anchors, so forwarding
 * it would put markup from a third party into our own error path. This reads
 * the machine-readable half and throws the prose away.
 *
 * Quota and a bad key are worth telling apart because only one of them is worth
 * retrying: an exhausted `search.list` bucket does not refill until midnight
 * Pacific, while the `videos.list` bucket it does *not* share is still working
 * fine — so a quota failure must degrade to "nothing new found" rather than
 * taking the wall's liveness down with it.
 */
export function readReason(status: number, json: unknown): Reason | null {
  if (status >= 200 && status < 300) return null;
  const error = (json as { error?: { errors?: unknown } })?.error;
  const errors = Array.isArray(error?.errors) ? error.errors : [];
  const quota = errors.some((e) => (e as { reason?: unknown })?.reason === "quotaExceeded");
  return status === 403 && quota ? "quota" : "upstream";
}

/**
 * Fold what we found into the wall.
 *
 * The contract is the entire safety story of auto-sourcing, so it is written
 * down rather than left to be re-read out of the loop:
 *
 * - **A stream you added by hand is never evicted.** Manual entries keep their
 *   place and their order; sourced ones fill what is left. The alternative is a
 *   feature that deletes your wall to make room for streams you did not pick.
 * - **A stream you removed never comes back.** `removeStream` records a sourced
 *   id as dismissed before dropping it, and those are filtered here. Without
 *   this the next visit re-adds it from the same cached search — and since
 *   removing a stream also clears its Notes transcript, that loop would quietly
 *   destroy your own writing every time round.
 * - **Dedupe by `videoId`, and the entry already on the wall wins.** Pasting a
 *   stream yourself and later finding it must not demote it to sourced, because
 *   sourced is what the sweep and the dismissal set act on.
 * - **Sourced entries are capped and swept.** `MAX_SOURCED` bounds how much of
 *   the wall this can take, and anything older than `SOURCED_TTL_MS` goes on the
 *   next merge.
 *
 * `now` is a parameter rather than a `Date.now()` call so the sweep can be
 * tested and so nothing here reads a clock during render.
 */
export function mergeSourced(
  wall: Stream[],
  found: Metadata[],
  dismissed: string[],
  now: number,
): Stream[] {
  // `Array.isArray` rather than `?? []`: every one of these three can arrive as
  // a hand-edited `{}` out of localStorage or a response that wasn't the shape
  // it claimed, and a nullish check waves those straight through into a `for…of`
  // that throws. This function has to answer over anything, not just over
  // absence.
  const skip = new Set(Array.isArray(dismissed) ? dismissed : []);
  const manual: Stream[] = [];
  const sourced: Stream[] = [];

  for (const entry of Array.isArray(wall) ? wall : []) {
    if (!entry?.videoId) continue;
    if (typeof entry.sourcedAt !== "number") manual.push(entry);
    else if (!skip.has(entry.videoId) && now - entry.sourcedAt < SOURCED_TTL_MS) {
      sourced.push(entry);
    }
  }

  const seen = new Set([...manual, ...sourced].map((s) => s.videoId));
  for (const meta of Array.isArray(found) ? found : []) {
    if (!meta?.videoId || seen.has(meta.videoId) || skip.has(meta.videoId)) continue;
    seen.add(meta.videoId);
    sourced.unshift({ ...meta, addedAt: now, sourcedAt: now });
  }

  return [...manual, ...sourced.slice(0, MAX_SOURCED)];
}
