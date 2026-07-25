/**
 * Seek-bar arithmetic, kept pure so the player component holds nothing but
 * glue. Every function here is deterministic and total — a live stream feeds
 * these NaNs, zeroes and shrinking numbers constantly, and a scrubber that
 * renders `NaN%` is worse than no scrubber.
 */

/** How far back we're willing to *offer* on a live stream when YouTube gives
 * us no way to ask. YouTube reports elapsed-since-broadcast-start as the
 * duration — which can be days — but the seekable DVR window is much smaller,
 * so we open a bounded window behind the live edge and shrink it whenever a
 * seek proves it was too generous. */
export const DEFAULT_DVR_SECONDS = 4 * 60 * 60;

/** Within this many seconds of the edge, a live viewer counts as "live". */
export const LIVE_EDGE_SLACK = 12;

export interface SeekWindow {
  /** Earliest offered position, in player time. */
  start: number;
  /** Latest offered position — the live edge on a live stream. */
  end: number;
}

export function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Clamp `n` into `[min, max]`, tolerating a collapsed or inverted range. */
export function clamp(n: number, min: number, max: number): number {
  if (!isFiniteNumber(n)) return min;
  if (max <= min) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * The range the scrubber offers.
 *
 * VOD: the whole video. Live: a bounded window behind the observed live edge,
 * never wider than `dvrSeconds` — which `narrowDvr` walks down as YouTube
 * refuses seeks.
 */
export function seekWindow({
  edge,
  isLive,
  dvrSeconds = DEFAULT_DVR_SECONDS,
}: {
  edge: number;
  isLive: boolean;
  dvrSeconds?: number;
}): SeekWindow {
  const end = isFiniteNumber(edge) && edge > 0 ? edge : 0;
  if (!isLive) return { start: 0, end };
  return { start: Math.max(0, end - Math.max(0, dvrSeconds)), end };
}

/** Position as a 0–1 fraction of the window. Always finite. */
export function fractionOf(position: number, win: SeekWindow): number {
  const span = win.end - win.start;
  // Nothing known yet (a stream that hasn't reported a duration) reads as
  // empty, not full — a bar pinned to 100% before playback is a lie.
  if (!(span > 0)) return win.end > 0 && isFiniteNumber(position) && position >= win.end ? 1 : 0;
  return clamp((position - win.start) / span, 0, 1);
}

/** Inverse of `fractionOf` — where a pointer at `fraction` wants to seek. */
export function positionAt(fraction: number, win: SeekWindow): number {
  const span = win.end - win.start;
  if (!(span > 0)) return win.end;
  return win.start + clamp(fraction, 0, 1) * span;
}

/** Fraction of the bar a pointer at `clientX` picked, given the bar's box. */
export function fractionFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (!(rect.width > 0)) return 0;
  return clamp((clientX - rect.left) / rect.width, 0, 1);
}

/** Seconds behind the live edge, floored at 0. */
export function behindLive(position: number, edge: number): number {
  if (!isFiniteNumber(position) || !isFiniteNumber(edge)) return 0;
  return Math.max(0, edge - position);
}

export function atLiveEdge(position: number, edge: number): boolean {
  if (!isFiniteNumber(edge) || edge <= 0) return true;
  return behindLive(position, edge) < LIVE_EDGE_SLACK;
}

/**
 * A seek landed far ahead of where it was aimed, so YouTube's DVR window is
 * shorter than we were offering: shrink it to what the stream actually
 * allowed, with a little slack so the new floor is reachable.
 *
 * Returns the previous value when the seek behaved, so callers can bail out of
 * a state update.
 */
export function narrowDvr({
  dvrSeconds,
  requested,
  landed,
  edge,
}: {
  dvrSeconds: number;
  requested: number;
  landed: number;
  edge: number;
}): number {
  if (!isFiniteNumber(requested) || !isFiniteNumber(landed) || !isFiniteNumber(edge)) {
    return dvrSeconds;
  }
  // A tolerance wide enough that ordinary keyframe snapping isn't read as a
  // refusal, but narrow enough to catch a clamp to the window floor.
  if (landed - requested < 30) return dvrSeconds;
  const allowed = Math.max(0, edge - landed);
  return Math.min(dvrSeconds, Math.max(60, allowed));
}

/** `H:MM:SS` / `M:SS` — compact enough to sit in a control strip. */
export function clock(seconds: number): string {
  const s = isFiniteNumber(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, "0")}` : `${mm}:${String(sec).padStart(2, "0")}`;
}

/** "LIVE" or how far behind it you are, in the shortest true words. */
export function liveOffsetLabel(position: number, edge: number): string {
  const behind = Math.floor(behindLive(position, edge));
  if (behind < LIVE_EDGE_SLACK) return "LIVE";
  if (behind < 60) return `-${behind}s`;
  return `-${clock(behind)}`;
}
