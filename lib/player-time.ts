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

/**
 * How long YouTube's own chrome takes to put itself away after a state change.
 *
 * Measured against a real `controls=0` embed, with our mask switched off so
 * there was something to actually look at: a resume or an API seek raises the
 * title bar, the avatar, a centred state glyph, the share button and the logo —
 * and then **fades all of it out by itself**. Up at 1s, visibly dissolving at
 * 2.5s, gone by 4s.
 *
 * Two things that measurement corrected, both of which this file previously
 * asserted as fact:
 *
 * 1. A **pause raises nothing at all**. Not the title bar, not a play button.
 *    The claim that pause chrome "stays until playback resumes" is false for
 *    this embed configuration — a paused picture is clean at 1.5s and still
 *    clean at 8s.
 * 2. Because the rest fades on its own, and gracefully, there is nothing here
 *    worth covering. Anything laid over the picture to hide it is more
 *    intrusive than the thing it hides, and lasts longer.
 *
 * So nothing masks the picture any more, and this constant survives for the one
 * job left to it: the wall's tiles are raw iframes with no JS API, so they have
 * no PLAYING event and hold their own poster for this long while warming up.
 */
export const YT_CHROME_MS = 4000;

/**
 * How long we wait for a picture before deciding autoplay was refused.
 *
 * Safari, iOS Low Power Mode and any tab without an engagement signal leave
 * the player parked at CUED forever. Nothing errors — it just never starts —
 * so the only way to know is to stop waiting.
 */
export const AUTOPLAY_GRACE_MS = 6000;

/**
 * Where the player is, as far as the picture is concerned.
 *
 * Deliberately separate from the `playing` flag that drives the transport
 * controls: that one folds BUFFERING into PLAYING so a seek doesn't flicker
 * the play icon, which is exactly the distinction the picture needs to keep.
 */
export type Phase = "cold" | "cued" | "buffering" | "playing" | "paused" | "ended";

/**
 * What, if anything, goes over the picture.
 *
 * - `poster`  — the video's own frame, before there is any decoded picture.
 * - `none`    — the picture, uncovered.
 * - `slate`   — a full cover. Only where there is no footage left to protect.
 *
 * There used to be a fourth: `mask`, a set of scrims and a disc laid over the
 * places YouTube paints its own chrome. It is gone. See `YT_CHROME_MS` for the
 * measurement that removed it — the short version is that a pause raises no
 * chrome at all and everything else fades itself out within three seconds, so
 * the cover was more intrusive, and longer-lived, than what it covered.
 */
export type Cover = "poster" | "none" | "slate";

export interface CoverInput {
  phase: Phase;
  /** Set once the player has reported PLAYING at least once. */
  hasPlayed: boolean;
  /** A refusal from YouTube — an embed ban, or a video that won't play. */
  failure?: boolean;
}

/**
 * The whole picture-cover decision, in one total function.
 *
 * The rule: a frame that exists is shown, and nothing is laid over it. A frame
 * that does not exist yet is stood in for by the poster, and a frame that is
 * gone for good gets a slate.
 */
export function pictureCover({ phase, hasPlayed, failure }: CoverInput): Cover {
  // Nothing to protect: YouTube paints an error card or an end-screen grid of
  // suggestions over the whole frame, and there is no footage under either.
  if (failure) return "slate";
  if (phase === "ended") return "slate";

  // No decoded picture yet — the poster is the only real frame we have. A
  // *mid-stream* stall is a different thing entirely and must not slam the
  // cover art over live footage, which is what `hasPlayed` separates.
  if (!hasPlayed && phase !== "playing") return "poster";

  // Paused, seeking, resuming, running — all of it is a picture, shown as one.
  return "none";
}

/** The words that go with a cover. Short enough to sit in a corner badge. */
export function coverLabel({
  phase,
  hasPlayed,
  failure,
  stalled,
}: {
  phase: Phase;
  hasPlayed: boolean;
  failure?: string;
  /** No picture after `AUTOPLAY_GRACE_MS` — autoplay was almost certainly refused. */
  stalled?: boolean;
}): string {
  if (failure) return failure;
  if (phase === "ended") return "Stream ended";
  if (phase === "paused") return "Paused";
  if (!hasPlayed) return stalled ? "Press play to start" : "Tuning in…";
  return "";
}

/** Within this many seconds of the edge, a live viewer counts as "live". */
export const LIVE_EDGE_SLACK = 12;

/* ---------------------------------------------------------------------------
   Where the live edge actually is.

   `getDuration()` does not know. That was the assumption this player was built
   on — "a live stream's duration keeps growing, and that growing number is the
   only live edge YouTube exposes" — and measuring it against real embeds showed
   it is false in both halves.

   Six live streams, two player instances each, 70s of 1Hz sampling:

   - `getDuration()` grew by **0.0s** on every one of them. It is frozen, not
     growing. `getCurrentTime()` is the only clock that moves.
   - On **9 of 12 instances** it sat **~3600s ahead** of the playhead. On the
     other 3 it sat ~20s behind. Two frames on the same page, same video,
     disagreed by exactly ±3600.1s — so which one you get is per-instance
     nondeterminism, not a property of the stream.

   That is the whole bug. A viewer sitting exactly on the live edge computed
   `edge - position ≈ 3600 - (seconds watched)`, so the offset label counted
   *down* from `-1:00:00` — `-55:52` about four minutes in — and the bar filled
   to roughly three-quarters instead of full. It also made a genuinely rewound
   viewer's offset decay while they sat still (measured: 597.1s, then 592.1s
   five seconds later), because a frozen edge with an advancing position closes
   the gap at 1s per second without the viewer catching up on anything.

   So the edge is measured instead, against a clock that is known to be honest.
   `slack = monotonicNow - position` is constant while riding the live edge —
   its absolute value is arbitrary, absorbing the broadcast epoch and the ~17s
   of ordinary stream latency — and it jumps the instant you rewind. The live
   edge is therefore the *smallest* slack seen recently, and how far behind you
   are is how far your slack has risen above it.

   Two things about that window are load-bearing:

   - The clock must be **monotonic** (`performance.now()`), not `Date.now()`.
     An NTP correction mid-session would otherwise land straight in the offset.
   - The floor is a **rolling minimum**, not an all-time one. A one-way ratchet
     strands the whole UI when the stream's steady-state latency legitimately
     rises — an ABR switch off a low-latency ladder, or a deeper buffer rebuilt
     after a stall. Slack settles above a floor captured in the first lucky
     minute, and a viewer who is *at* the edge reads `-25s` forever, amber, with
     a Live button lit but dead: pressing it seeks past the real edge and the
     offset never drops. A dead control is worse than a wrong number, so the
     floor is allowed to rise again by letting old samples age out.
--------------------------------------------------------------------------- */

/** How far back the live-edge floor looks. Long enough to ride out a rewind
 *  and back, short enough to absorb a latency regime change. */
export const LAG_WINDOW_SECONDS = 90;

/**
 * How far a reading may sit from the established floor and still be believed.
 *
 * Note what this does *not* bound: slack itself. Its absolute value is
 * arbitrary — it absorbs the broadcast epoch, so on a stream that has been
 * running for months it is some large negative number, and on a fresh one it is
 * near zero. Banding it directly would reject every reading from a long-running
 * broadcast, which is most of them.
 *
 * What is bounded is the *distance* from the floor, which is a real quantity:
 * how far behind the live edge a reading claims we are. Nothing legitimate
 * exceeds the length of a broadcast, so a week is generous, and anything past
 * it is a reading from a clock we do not understand — a player handing back an
 * epoch, or milliseconds where seconds were expected. Getting that wrong is not
 * a rounding error: mixing two such clocks in one estimate renders an offset of
 * `-472000:00:00` and lights every behind-live control on the bar.
 */
export const LAG_SANE_DRIFT = 7 * 86_400;

/** One reading: when it was taken, and the slack it saw. */
export interface LagSample {
  /** Monotonic seconds. */
  at: number;
  slack: number;
}

export interface LiveLag {
  /** Readings inside the window, oldest first. */
  samples: LagSample[];
  /** The most recent slack. */
  latest: number;
  /** The smallest slack in the window — our estimate of the live edge. */
  floor: number;
}

/**
 * Fold one reading into the lag estimate.
 *
 * Returns `prev` **by identity** when nothing moved, so the caller can bail out
 * of a state update — same contract as `narrowDvr`, and for the same reason.
 * This one is polled four times a second, and handing back a fresh object each
 * time would re-render the entire player at 4Hz for no change.
 */
export function trackLag(prev: LiveLag | null, at: number, position: number): LiveLag | null {
  if (!isFiniteNumber(at) || !isFiniteNumber(position)) return prev;
  const slack = at - position;
  if (prev && Math.abs(slack - prev.floor) > LAG_SANE_DRIFT) return prev;

  const kept = (prev?.samples ?? []).filter((s) => at - s.at <= LAG_WINDOW_SECONDS);
  kept.push({ at, slack });

  let floor = slack;
  for (const s of kept) if (s.slack < floor) floor = s.slack;

  if (prev && prev.latest === slack && prev.floor === floor) return prev;
  return { samples: kept, latest: slack, floor };
}

/** Seconds behind the live edge. Always finite, never negative. */
export function lagBehind(lag: LiveLag | null): number {
  if (!lag || !isFiniteNumber(lag.latest) || !isFiniteNumber(lag.floor)) return 0;
  return Math.max(0, lag.latest - lag.floor);
}

/**
 * Shift the whole estimate by a seek the player has been asked for but has not
 * performed yet.
 *
 * On a live stream the bar's fill is `1 - behind/span` — `position` cancels out
 * of it, because what the bar means is *how far back in the window you are*.
 * So optimistically moving `position` on its own moves nothing on screen, and
 * the knob would sit frozen through the second or two of buffering before the
 * next honest reading lands, then jump. Moving the lag by the same delta lets
 * the knob follow the intent immediately.
 */
export function shiftLag(lag: LiveLag | null, seconds: number): LiveLag | null {
  if (!lag || !isFiniteNumber(seconds) || seconds === 0) return lag;
  return { ...lag, latest: lag.latest + seconds };
}

/**
 * Where the far end of the bar is — the one decision this whole ticket turned
 * on, extracted so it can be tested rather than inferred from a component.
 *
 * A recording's duration is exactly right and is used as-is. A live stream's is
 * not used at all: the edge is the playhead plus however far behind it we have
 * measured ourselves to be, which puts a viewer at the edge at `fraction = 1`
 * by construction.
 */
export function liveEdge({
  live,
  duration,
  position,
  behind,
}: {
  live: boolean;
  duration: number;
  position: number;
  /** Seconds behind the live edge, from `lagBehind`. */
  behind: number;
}): number {
  if (!live) return isFiniteNumber(duration) && duration > 0 ? duration : 0;
  if (!isFiniteNumber(position)) return 0;
  return Math.max(0, position + (isFiniteNumber(behind) ? Math.max(0, behind) : 0));
}

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
