/**
 * The wall's contents. Every field here comes from the platform the stream is
 * on — nothing on vibers.tv is invented about a stream or its creator.
 *
 * The wall is **shared**. It lives in a Neon Postgres database behind
 * `app/api/streams`, so a stream anyone puts up is on the wall for everyone,
 * on every device, and it is still there tomorrow. It used to live in each
 * browser's localStorage, which made "your wall" literally true and "the wall"
 * impossible — two people on the same site saw two different walls.
 *
 * This module is now two halves that no longer share a mechanism:
 *
 * - **The deciding** — `shelf`, `partition`, `cardState`, `mergeStatuses` and
 *   friends. Pure, total over a `Stream`, and unchanged by the move; they run
 *   in the browser and on the server, and they are what the suite pins.
 * - **The asking** — `listStreams` and the calls below it. Every one is a
 *   `fetch` at the wall's routes, and every one is async. There is no local
 *   path and no cache to fall back to: if the database can't be reached the
 *   call throws and the wall says so, because silently showing someone an
 *   empty or private wall is the bug this replaced.
 *
 * The writing itself lives in `lib/wall.ts`, server-side.
 */

import { clearMessages } from "./chat";
import type { DiscoverResult } from "./discover";
import { parseKey } from "./source";
import type { WatchlistResult } from "./watch";

export interface Stream {
  /**
   * The **source key** — what the wall stores, and what `/watch/<key>` carries.
   *
   * Still called `videoId` because that is the column, the URL segment and the
   * prop name everywhere, and renaming it would be a migration for a word. What
   * it holds is `lib/source.ts`' key: a bare eleven-character id is YouTube, and
   * anything with a provider prefix (`twitch:channel:someone`) is that provider.
   * Never parse it by hand — `parseKey` is the one place that knows.
   */
  videoId: string;
  title: string;
  channel: string;
  channelUrl?: string;
  thumbnail: string;
  description?: string;
  /** Only set when the Data API confirmed it. Absent means "we don't know". */
  isLive?: boolean;
  viewers?: number;
  /**
   * When the broadcast ended, ISO, straight from `liveStreamingDetails`.
   *
   * This is the field that separates the two things `isLive: false` collapses
   * together: a stream that ran and finished, and a video that was never live
   * at all. YouTube only carries `liveStreamingDetails` for something that was
   * once a broadcast, so its presence *is* the distinction.
   */
  endedAt?: string;
  /** Epoch ms, stamped server-side when added. Never read during render. */
  addedAt: number;
  /**
   * Epoch ms, set only on a stream the site went and found by keyword.
   *
   * Its presence is the whole distinction between "you put this here" and "we
   * put this here", and three behaviours hang off it: the sweep that drops
   * sourced streams after a day, the cap that stops them taking the wall, and
   * the dismissal that makes removing one stick. A stream you added yourself
   * has no `sourcedAt` and is therefore subject to none of them.
   */
  sourcedAt?: number;
}

/** What the status route reports back for one video. */
export interface Status {
  isLive: boolean;
  viewers?: number;
  endedAt?: string;
}

export interface Metadata extends Omit<Stream, "addedAt"> {}

/**
 * Ask the wall's routes. Every one of these throws rather than degrading.
 *
 * A shared wall has exactly one honest failure mode: say so. Returning an
 * empty array on a 503 would render "Nothing on the wall" over a wall that is
 * full, and returning a stale local copy would put the per-browser wall back
 * under a coat of paint. So the error travels, and `MonitorWall` shows it.
 */
async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new Error(data?.error ?? "The wall isn't answering.");
  return data;
}

/** Ask the site what a link or a stored key actually is. Either platform. */
export async function lookup(input: string): Promise<Metadata> {
  return ask<Metadata>(`/api/lookup?v=${encodeURIComponent(input)}`);
}

export async function listStreams(): Promise<Stream[]> {
  return (await ask<{ streams: Stream[] }>("/api/streams")).streams;
}

/**
 * Put a stream up, by id.
 *
 * The id and nothing else: the route looks the video up itself. On a wall
 * everyone can see, a title and a thumbnail posted by the client would be
 * arbitrary text and an arbitrary `img src` on everyone's screen — see the
 * note in `lib/lookup.ts`.
 */
export async function addStream(
  videoId: string,
): Promise<{ streams: Stream[]; added: Metadata }> {
  return ask<{ streams: Stream[]; added: Metadata }>("/api/streams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: videoId }),
  });
}

/**
 * Take a stream off — for everyone. That is what a shared wall means.
 *
 * The dismissal that stops auto-sourcing putting a sourced stream straight
 * back is recorded server-side now, since the search behind it is shared too.
 * The Notes transcript is not: it is written by one person, in one browser,
 * and stays there, so clearing it stays here.
 */
export async function removeStream(videoId: string): Promise<Stream[]> {
  clearMessages(videoId);
  const data = await ask<{ streams: Stream[] }>(`/api/streams?v=${encodeURIComponent(videoId)}`, {
    method: "DELETE",
  });
  return data.streams;
}

/**
 * Ask the site to go and find live streams, and fold what it finds into the wall.
 *
 * Read, merge and write all happen inside the route against one row set —
 * which is the lost-update problem this used to have, gone. Two tabs doing
 * this at once used to each read the store, merge into their own snapshot and
 * write it back, so whichever landed second silently undid the other.
 *
 * Two findings come back from the one call, because they answer different
 * questions and fail for different reasons. `result` is sourcing, and it carries
 * a leg per platform: YouTube by keyword — what is live that matches "live
 * coding" — which can be switched off or out of quota for the day, and Twitch by
 * category, which can be switched off or pointed at a name Twitch does not know
 * but cannot run out of anything, because Helix's limit refills every minute.
 * `watchlist` is the channels an admin named — are *they* on air — which also
 * cannot be out of quota, because reading a channel's newest videos costs
 * nothing.
 */
export interface SourceRun {
  streams: Stream[];
  result: DiscoverResult;
  watchlist: WatchlistResult;
}

export async function sourceStreams(): Promise<SourceRun> {
  return ask<SourceRun>("/api/streams/source", { method: "POST" });
}

/** Take every sourced stream off at once — again, for everyone — and remember each one. */
export async function clearSourced(): Promise<Stream[]> {
  const data = await ask<{ streams: Stream[] }>("/api/streams?sourced=1", { method: "DELETE" });
  return data.streams;
}

export async function findStream(videoId: string): Promise<Stream | undefined> {
  return (await listStreams()).find((s) => s.videoId === videoId);
}

/* ---------------------------------------------------------------------------
   Which shelf a stream sits on.

   Pure, and deliberately so: the wall's store is a set of `fetch` calls at
   routes that talk to Postgres, none of which the node environment the suite
   runs in can stand up. These take a stream and return an answer, which is the
   half worth pinning — same shape as `pictureCover` in `player-time.ts`.
   `mergeStatuses` and `mergeSourced` being pure is also what lets the server
   apply them: the rules the suite pins are the rules the database gets.
--------------------------------------------------------------------------- */

export type Shelf = "live" | "ended";

/**
 * Live or ended, over the three states YouTube actually reports.
 *
 * `isLive` is a tri-state — true, false, or unconfirmed — and `endedAt` adds
 * the distinction it can't carry on its own. The unconfirmed case lands on the
 * live shelf for the reason `chat.ts` already gives for the chat tab: without
 * `YOUTUBE_API_KEY` every stream reads `undefined`, and treating that as "not
 * live" would sweep a genuinely live wall into a tab labelled Ended. An end
 * time is still proof, though, so an unconfirmed stream that carries one is
 * ended regardless.
 */
export function shelf(stream: Stream): Shelf {
  if (stream?.isLive === true) return "live";
  if (stream?.isLive === false) return "ended";
  return stream?.endedAt ? "ended" : "live";
}

/** The wall, split in two, each side keeping the order it came in. */
export function partition(streams: Stream[]): Record<Shelf, Stream[]> {
  const live: Stream[] = [];
  const ended: Stream[] = [];
  for (const stream of streams ?? []) {
    if (shelf(stream) === "live") live.push(stream);
    else ended.push(stream);
  }
  return { live, ended };
}

/**
 * What the card says about itself — finer than the shelf it sits on.
 *
 * The Ended shelf holds two different things, and saying "ended" over a music
 * video that was never a broadcast would be inventing a fact. So the tab is
 * coarse and the card is precise.
 */
export type CardState = "live" | "ended" | "video" | "unknown";

export function cardState(stream: Stream): CardState {
  if (stream?.isLive === true) return "live";
  if (stream?.endedAt) return "ended";
  if (stream?.isLive === false) return "video";
  return "unknown";
}

/**
 * What the card actually *says* — the state, in the words of its platform.
 *
 * `cardState` is about the facts and stays platform-blind; this is about the
 * noun, and the noun differs. A Twitch **channel** that is confirmed not live is
 * "Offline", not "Video": there is no video there, only a channel that isn't
 * broadcasting, and it will be a different broadcast when it is. Saying "Video"
 * over it would be the same category error `cardState` already avoids by
 * refusing to say "Ended" over something that was never a broadcast.
 *
 * A Twitch VOD or clip really is a recording, so it keeps "Video".
 */
export function stateLabel(stream: Stream): string {
  const state = cardState(stream);
  if (state === "live") return "Live";
  if (state === "unknown") return "Stream";
  const source = parseKey(stream?.videoId ?? "");
  if (source?.provider === "twitch" && source.kind === "channel") return "Offline";
  return state === "ended" ? "Ended" : "Video";
}

/**
 * The wall's three views — what the tab bar selects.
 *
 * A shelf is a fact about a stream; a view is a question being asked of the
 * wall, and the two stopped being the same thing when the wall became one feed.
 * **All** stacks both shelves — live first, ended underneath, reached by
 * scrolling — and **Live** and **Ended** narrow that feed to one shelf. So the
 * tabs filter the wall rather than being the only route to half of it: what is
 * ended is always one scroll away, and the tab bar is still there for when you
 * want only one kind.
 *
 * This is what replaced `initialShelf`, which existed to stop the wall opening
 * on an empty Live tab when everything had ended. All answers that structurally
 * instead of by guessing: there is no default view that can hide what the wall
 * holds, so there is nothing to correct for on load.
 */
export type WallView = "all" | Shelf;

export const WALL_VIEWS: WallView[] = ["all", "live", "ended"];

/** Everything, live first — the wall is about what is on air, not only about it. */
export const DEFAULT_VIEW: WallView = "all";

/** The shelves a view shows, in the order the feed stacks them down the page. */
export function shelvesFor(view: WallView): Shelf[] {
  return view === "all" ? ["live", "ended"] : [view];
}

/**
 * How the wall draws a tile: a thumbnail, or a live muted player.
 *
 * It lives here rather than in the component for the same reason the shelf
 * rules do — the wall's default view is a fact about the product, and a fact
 * worth pinning in the suite is one the node environment has to be able to
 * import without dragging React in behind it.
 */
export type Mode = "posters" | "monitors";

export const MODES: Mode[] = ["posters", "monitors"];

/**
 * Monitors, not posters.
 *
 * The wall is the product, and the wall is a bank of running players — posters
 * are the cheap fallback, and opening on them made every first visit look like
 * a grid of stills you had to go find a switch to animate. So the switch starts
 * flipped. It costs one embed per live tile on load, which is exactly what the
 * monitors mode has always cost; the tiles already stagger themselves with
 * `loading="lazy"` so the off-screen ones wait their turn, and the Ended shelf
 * still takes no player in any mode.
 *
 * Nothing persists this — the toggle is component state — so "default" means
 * the state every load starts in, not a preference someone can outlive.
 */
export const DEFAULT_MODE: Mode = "monitors";

/**
 * Fold fresh liveness into the wall.
 *
 * The contract is the whole point of this being its own function, so it is
 * written down rather than implied:
 *
 * - Matched by `videoId`, and **nothing is ever added**. A stream taken off the
 *   wall while the request was in flight has already had its chat transcript
 *   dropped by `removeStream`; putting it back from a stale response would
 *   resurrect a half-deleted stream.
 * - An id **missing** from the response leaves its entry exactly as it was. A
 *   deleted or privated video simply returns nothing, and reading that absence
 *   as "not live" would quietly file a live stream under Ended.
 * - `viewers` is **cleared** the moment a stream is no longer live. It counts
 *   concurrent viewers, so keeping the last one would leave a grey ended card
 *   reading "12.4K watching" forever.
 */
export function mergeStatuses(streams: Stream[], statuses: Record<string, Status>): Stream[] {
  return (streams ?? []).map((stream) => {
    const status = statuses?.[stream?.videoId];
    if (!status) return stream;
    return {
      ...stream,
      isLive: status.isLive,
      viewers: status.isLive ? status.viewers : undefined,
      endedAt: status.endedAt,
    };
  });
}

/**
 * Re-ask YouTube what is still on air, and write the answer back.
 *
 * Without this the wall never moves: `isLive` is stamped once when a stream is
 * added and then believed forever, so a stream that ends while it sits up
 * stays in the Live tab until someone takes it down and puts it back.
 *
 * The batching that used to happen here now happens in the route, and that is
 * a saving rather than a relocation: one refresh serves everybody, instead of
 * every visitor spending their own calls asking the same question about the
 * same sixty ids.
 */
export async function refreshLiveness(): Promise<Stream[]> {
  const data = await ask<{ streams: Stream[] }>("/api/streams/refresh", { method: "POST" });
  return data.streams;
}

export const RIGHTS_CONTACT = "rights@vibers.tv";
