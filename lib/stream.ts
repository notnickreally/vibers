/**
 * The wall's contents. Every field here comes from YouTube — nothing on
 * vibers.tv is invented about a stream or its creator.
 *
 * There is no database yet, so the wall lives in localStorage: it's yours, it
 * persists across visits, and it does not sync between devices.
 */

import { clearMessages } from "./chat";
import { type DiscoverResult, MAX_DISMISSED, mergeSourced } from "./discover";
import { MAX_IDS } from "./youtube";

export interface Stream {
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
  /** Epoch ms, stamped client-side when added. Never read during render. */
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

const KEY = "vibers:wall";
const DISMISSED_KEY = "vibers:wall:dismissed";
const MAX = 60;

export async function lookup(input: string): Promise<Metadata> {
  const res = await fetch(`/api/youtube?v=${encodeURIComponent(input)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Lookup failed.");
  return data as Metadata;
}

export function listStreams(): Stream[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Stream[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addStream(meta: Metadata): Stream[] {
  const stream: Stream = { ...meta, addedAt: Date.now() };
  const next = [stream, ...listStreams().filter((s) => s.videoId !== meta.videoId)].slice(0, MAX);
  write(next);
  return next;
}

export function removeStream(videoId: string): Stream[] {
  // Taking a *sourced* stream off has to be remembered, not just done. The
  // search behind it is cached for hours, so the next visit would find the same
  // id and put it straight back — and since the line below drops the stream's
  // Notes with it, that loop would destroy your own writing once per visit
  // rather than once. Manual streams need none of this: nothing re-adds them.
  if (findStream(videoId)?.sourcedAt !== undefined) dismiss(videoId);
  // A stream's chat is stored under its own key, so taking it off the wall has
  // to take the transcript with it — otherwise the keys accumulate forever.
  clearMessages(videoId);
  const next = listStreams().filter((s) => s.videoId !== videoId);
  write(next);
  return next;
}

/**
 * Ids the viber has thrown off the wall, so auto-sourcing won't offer them again.
 *
 * A plain list rather than a set of timestamps: what matters is membership, and
 * the cap keeps a key that only ever grows from growing forever. Oldest out
 * first — a stream dismissed two hundred dismissals ago has almost certainly
 * ended anyway, and if it hasn't, offering it once more is a small wrong.
 */
export function listDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function dismiss(videoId: string): void {
  if (typeof window === "undefined") return;
  const next = [videoId, ...listDismissed().filter((id) => id !== videoId)].slice(
    0,
    MAX_DISMISSED,
  );
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    // Private browsing. The dismissal holds for this session and no longer.
  }
}

/**
 * Ask the site to go and find live streams, and fold what it finds into the wall.
 *
 * The store is re-read here rather than taken from the caller, for the same
 * reason `refreshLiveness` re-reads before writing: the wall's other async
 * landing is in flight at almost exactly this moment, and whichever of the two
 * closed over an older snapshot would silently undo the other. One read, one
 * merge, one write.
 */
export async function sourceStreams(): Promise<{ streams: Stream[]; result: DiscoverResult }> {
  const empty: DiscoverResult = { keywords: [], streams: [], reason: "upstream" };
  let result = empty;
  try {
    const res = await fetch("/api/youtube/discover");
    if (res.ok) result = (await res.json()) as DiscoverResult;
  } catch {
    // Offline, or the route is down. The wall keeps what it already has.
  }

  const next = mergeSourced(listStreams(), result.streams ?? [], listDismissed(), Date.now()).slice(
    0,
    MAX,
  );
  write(next);
  return { streams: next, result };
}

/**
 * Take every sourced stream off at once, and remember each one.
 *
 * The sweep in `mergeSourced` does this on its own after a day; this is for
 * wanting your own wall back before then. It goes through `removeStream` per
 * id rather than filtering in one pass, because each one still has a Notes
 * transcript to clear and a dismissal to record.
 */
export function clearSourced(): Stream[] {
  let next = listStreams();
  for (const stream of next.filter((s) => s.sourcedAt !== undefined)) {
    next = removeStream(stream.videoId);
  }
  return next;
}

export function findStream(videoId: string): Stream | undefined {
  return listStreams().find((s) => s.videoId === videoId);
}

/* ---------------------------------------------------------------------------
   Which shelf a stream sits on.

   Pure, and deliberately so: the wall's store reads `window.localStorage`
   directly, so nothing in it survives the node environment the test suite runs
   in. These take a stream and return an answer, which is the half worth
   pinning — same shape as `pictureCover` in `player-time.ts`.
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

/** Opening on an empty Live tab when everything has ended helps nobody. */
export function initialShelf(streams: Stream[]): Shelf {
  const { live } = partition(streams);
  return live.length === 0 && (streams?.length ?? 0) > 0 ? "ended" : "live";
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
 * added and then believed forever, so a stream that ends while it sits on your
 * wall stays in the Live tab until you take it down and put it back.
 *
 * The wall holds more streams than `videos.list` takes ids, so this goes in
 * chunks — two calls at the very top end, one unit each against a daily
 * allowance of ten thousand. The store is re-read at write time rather than
 * reused from the top of the function, so anything added or removed while the
 * requests were out survives them.
 */
export async function refreshLiveness(): Promise<Stream[]> {
  const ids = listStreams().map((s) => s.videoId);
  if (ids.length === 0) return [];

  const statuses: Record<string, Status> = {};
  for (let i = 0; i < ids.length; i += MAX_IDS) {
    const chunk = ids.slice(i, i + MAX_IDS);
    try {
      const res = await fetch(`/api/youtube/status?ids=${chunk.join(",")}`);
      if (!res.ok) continue;
      const data = (await res.json()) as { statuses?: Record<string, Status> };
      Object.assign(statuses, data.statuses ?? {});
    } catch {
      // Offline, or the route is down. The wall keeps what it already knows.
    }
  }

  const next = mergeStatuses(listStreams(), statuses);
  write(next);
  return next;
}

function write(streams: Stream[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(streams));
  } catch {
    // Private browsing — the wall just won't survive the session.
  }
}

export const RIGHTS_CONTACT = "rights@vibers.tv";
