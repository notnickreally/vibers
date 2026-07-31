"use client";

import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  BackIcon,
  ExitFullscreenIcon,
  ForwardIcon,
  FullscreenIcon,
  LiveEdgeIcon,
  PauseIcon,
  PlayIcon,
  VolumeIcon,
} from "@/components/player/icons";
import { LiveBadge } from "@/components/ui/bits";
import {
  atLiveEdge,
  AUTOPLAY_GRACE_MS,
  clamp,
  clock,
  coverLabel,
  DEFAULT_DVR_SECONDS,
  fractionFromPointer,
  fractionOf,
  isFiniteNumber,
  lagBehind,
  liveEdge,
  type LiveLag,
  liveOffsetLabel,
  narrowDvr,
  type Phase,
  pictureCover,
  positionAt,
  type SeekWindow,
  seekWindow,
  shiftLag,
  trackLag,
} from "@/lib/player-time";
import { posterFallbackUrl, posterUrl } from "@/lib/youtube";

/**
 * A clean picture — and one that is always a picture.
 *
 * YouTube's own control bar is turned off (`controls=0`) and we drive playback
 * through the IFrame Player API instead. Every control — the title, the
 * scrubber, play/pause, volume, fullscreen — is our own markup, and all of it
 * lives in siblings *outside* the frame.
 *
 * YouTube's own chrome — title bar, avatar, share, watch-later, end-screen
 * suggestions — is painted inside a cross-origin iframe and cannot be removed
 * from the outside. It can only be kept from being summoned, or covered.
 * Hover and clicks are eaten by a transparent shield, so during playback it
 * never appears at all. That shield is no longer inert: clicking the picture
 * plays and pauses it, and on a pointer that has a double-click, a double-click
 * goes fullscreen. This is the balance the ticket asked for, stated as one
 * rule — **our UI owns every interaction with the picture; YouTube's owns
 * none** — and it is also the cheapest fix, because a click that never reaches
 * the iframe is chrome that is never summoned in the first place.
 *
 * What the shield cannot reach is the chrome a *state change* raises. Nothing
 * is laid over the picture to hide that, and the history of this file is two
 * rounds of learning why not: first the whole frame was blacked out, then only
 * the places YouTube paints were covered with scrims and a disc. Both were
 * built on an assumption nobody had checked.
 *
 * Checking it — screenshotting a real embed with the cover switched off —
 * showed that **a pause raises no YouTube chrome at all**, and that what a
 * resume or a seek does raise fades itself out gracefully inside three
 * seconds. The cover was heavier than the thing it covered and stayed up
 * longer. So it is gone: the picture is the picture, and YouTube's own chrome
 * is left to come and go on its own, which it does faster than any furniture
 * of ours could. `YT_CHROME_MS` in `lib/player-time` carries the measurement.
 *
 * What remains over the picture is only what stands in for a frame that isn't
 * there: the video's poster before anything has decoded, and a slate in the
 * two places with no footage to protect — a refusal, and the end-screen grid.
 * `pictureCover` is that whole decision, and it is where to change it.
 *
 * Note what this costs. Hiding the embed's branding is against YouTube's embed
 * terms, and the attribution it carries is part of what makes carrying someone
 * else's stream defensible — the channel link and "Watch on YouTube" below the
 * player are now the only place that credit appears. Product's call, taken
 * knowingly; if it is ever revisited, deleting the shield restores the embed.
 */

interface Player {
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(v: number): void;
  getVolume(): number;
  getDuration(): number;
  getCurrentTime(): number;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}

interface PlayerStates {
  UNSTARTED: number;
  ENDED: number;
  PLAYING: number;
  PAUSED: number;
  BUFFERING: number;
  CUED: number;
}

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => Player;
      PlayerState: PlayerStates;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** Vendor-prefixed fullscreen, still the only way in on older WebKit. */
interface FullscreenCapable extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}
interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}

let apiPromise: Promise<void> | null = null;

function loadApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

/**
 * The embed we build ourselves.
 *
 * Letting the API build it costs three serialised round trips before a single
 * video byte is asked for — hydrate, fetch `iframe_api`, fetch `base.js`, and
 * only then is an iframe created and the video requested. Writing the iframe
 * first puts the video on the wire immediately and lets the API script load
 * alongside it; handed a real iframe rather than a placeholder div, `YT.Player`
 * attaches to it in place instead of replacing it, so nothing is thrown away.
 *
 * `enablejsapi` is what makes that attach possible and is the one parameter
 * here that is not simply the old `playerVars` written out.
 */
function embedSrc(videoId: string, start?: number): string {
  const params = new URLSearchParams({
    enablejsapi: "1",
    controls: "0",
    rel: "0",
    iv_load_policy: "3",
    disablekb: "1",
    fs: "0",
    playsinline: "1",
    // Autoplay is only honoured muted; the mute button is right underneath.
    autoplay: "1",
    mute: "1",
    start: String(start ?? 0),
    origin: window.location.origin,
  });
  return `https://www.youtube.com/embed/${videoId}?${params}`;
}

/** How often we read the clock off the player. Smooth without being greedy. */
const TICK_MS = 250;

/**
 * How long a seek gets to settle before we read anything into where it landed.
 *
 * Two races live in the gap between asking for a seek and the player performing
 * one, and both of them bite when the back button is pressed faster than the
 * poll runs:
 *
 * - The poll would overwrite the optimistic position with the player's *old*
 *   time — it has not moved yet — so the next nudge starts from where the last
 *   one did and ten presses walk back sixty seconds instead of six hundred.
 * - `narrowDvr` would compare the newest aim against a position from before any
 *   of the seeks, read the difference as YouTube refusing the seek, and shrink
 *   the DVR window to its floor. Measured: ten presses at 120ms collapsed a
 *   four-hour window to sixty seconds and emptied the bar.
 *
 * So a seek is judged only once the player is PLAYING again and this much time
 * has passed, and every fresh seek restarts the clock — which means a burst of
 * presses is judged once, when it stops, rather than once per press.
 */
const SEEK_SETTLE_MS = 1200;

/** After this long an unsettled seek is abandoned, so a seek that never lands
 *  cannot freeze the readout for the rest of the session. */
const SEEK_ABANDON_MS = 5000;

/** What YouTube says when it won't be embedded — worth saying plainly. */
const EMBED_REFUSED = new Set([101, 150]);

/**
 * The one thing the page outside the player is allowed to ask of it.
 *
 * It exists because the description has chapter marks in it now, and a chapter
 * mark has to move the picture that is already playing. The `start` prop cannot
 * do that: it is a dependency of the effect that builds the embed, so changing
 * it destroys the player and writes a new iframe — the video reloads from cold,
 * buffers, and flashes its poster, which is not what "12:34" promises.
 *
 * So the seek goes out instead of the time coming in. Nothing else is
 * published: the transport, the volume and the live edge stay the player's own
 * business, because they are controls a reader is looking at while they use
 * them, and this is the one action that starts somewhere else on the page.
 */
export interface PlayerHandle {
  /** Move the picture to `seconds`, clamped to what is actually seekable. */
  seekTo(seconds: number): void;
}

export function CleanPlayer({
  videoId,
  start,
  isLive,
  title,
  channel,
  ref,
}: {
  videoId: string;
  start?: number;
  /** Only true when YouTube confirmed it. Gates the live-edge controls. */
  isLive?: boolean;
  /** Shown in our own title strip above the picture. */
  title?: string;
  channel?: string;
  ref?: Ref<PlayerHandle>;
}) {
  const shellRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<Player | null>(null);

  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(100);

  // Where the picture is. Kept apart from `playing` on purpose: that flag
  // folds BUFFERING into PLAYING so a seek doesn't flicker the transport
  // icons, and folding them is exactly what the picture must not do.
  const [phase, setPhase] = useState<Phase>("cold");
  // Latched on the first PLAYING. Without it a mid-stream buffer stall is
  // indistinguishable from a cold start, and every network hiccup twenty
  // minutes into a stream would slam the cover art over live footage.
  const [hasPlayed, setHasPlayed] = useState(false);
  // No picture after the grace window means autoplay was refused rather than
  // slow — Safari and iOS Low Power Mode park the player at CUED forever, and
  // nothing errors, so the only way to know is to stop waiting.
  const [stalled, setStalled] = useState(false);
  const [poster, setPoster] = useState(() => posterUrl(videoId));

  // Playback clock, polled — never read during render from the player itself.
  const [position, setPosition] = useState(0);
  // What YouTube claims the duration is. Correct for a recording, and for a
  // live stream not to be believed at all — see the live-edge note in
  // `lib/player-time`. Kept because `liveEdge` still needs it for the VOD case.
  const [duration, setDuration] = useState(0);
  // How far behind the live edge we have measured ourselves to be. The lag
  // estimate it comes from lives in a ref rather than state: it is folded four
  // times a second and only this rounded number ever needs to reach the DOM.
  const [behind, setBehind] = useState(0);
  const lagRef = useRef<LiveLag | null>(null);
  const [dvrSeconds, setDvrSeconds] = useState(DEFAULT_DVR_SECONDS);

  // While a finger is down the bar follows the finger, not the poll — and it
  // measures against the window the drag started on, not one that has moved
  // since.
  const [scrub, setScrub] = useState<number | null>(null);
  const dragWinRef = useRef<SeekWindow | null>(null);
  // Where the last seek was aimed, and when — the timestamp is what lets a
  // burst of presses be judged once, after it stops. See `SEEK_SETTLE_MS`.
  const seekAimRef = useRef<{ target: number; at: number } | null>(null);
  // Where a *mouse* is hovering the bar, so it can say what is under the
  // cursor before you commit to it. Null on touch, which has no hover.
  const [hover, setHover] = useState<number | null>(null);

  const [fullscreen, setFullscreen] = useState(false);
  const [fsSupported, setFsSupported] = useState(false);

  const live = isLive === true;

  useEffect(() => {
    const host = frameRef.current;
    if (!host) return;

    let cancelled = false;
    let player: Player | null = null;

    // React must own nothing inside this host: the API mutates whatever it is
    // given, and clearing a node React owns makes its own removal throw
    // NotFoundError later. So the iframe is built here, by hand — which also
    // puts the video on the wire before the API script has even been fetched.
    const frame = document.createElement("iframe");
    frame.src = embedSrc(videoId, start);
    frame.title = "Stream";
    frame.allow = "autoplay; encrypted-media; picture-in-picture";
    frame.className = "absolute inset-0 h-full w-full border-0";
    host.appendChild(frame);
    iframeRef.current = frame;

    setReady(false);
    setFailure("");
    setPosition(0);
    setDuration(0);
    setBehind(0);
    lagRef.current = null;
    setDvrSeconds(DEFAULT_DVR_SECONDS);
    setPhase("cold");
    setHasPlayed(false);
    setStalled(false);
    setPoster(posterUrl(videoId));

    loadApi().then(() => {
      if (cancelled || !window.YT) return;
      // Given an existing `enablejsapi` iframe the API attaches in place; the
      // download already in flight above is kept rather than restarted.
      player = new window.YT.Player(frame, {
        events: {
          onReady: () => {
            if (cancelled) return;
            setReady(true);
            setVolume(player?.getVolume() ?? 100);
            setMuted(player?.isMuted() ?? true);
          },
          onStateChange: (e: { data: number }) => {
            if (cancelled || !window.YT) return;
            const s = window.YT.PlayerState;
            const next: Phase =
              e.data === s.PLAYING
                ? "playing"
                : e.data === s.PAUSED
                  ? "paused"
                  : e.data === s.BUFFERING
                    ? "buffering"
                    : e.data === s.ENDED
                      ? "ended"
                      : e.data === s.CUED
                        ? "cued"
                        : "cold";
            setPhase(next);
            if (next === "playing") setHasPlayed(true);
            // Buffering is still "playing" as far as the button is concerned —
            // otherwise every seek flickers the icon back to play.
            setPlaying(next === "playing" || next === "buffering");
          },
          onError: (e: { data: number }) => {
            if (cancelled) return;
            setFailure(
              EMBED_REFUSED.has(e.data)
                ? "This channel doesn't allow its stream to play outside YouTube."
                : "YouTube couldn't play this video.",
            );
          },
        },
      });
      playerRef.current = player;
    });

    return () => {
      cancelled = true;
      try {
        player?.destroy();
      } catch {
        // A player torn down mid-construction throws; nothing left to clean.
      }
      playerRef.current = null;
      iframeRef.current = null;
      // destroy() takes the iframe with it; this clears anything it left —
      // including the iframe itself when the API never arrived to adopt it.
      host.replaceChildren();
    };
  }, [videoId, start]);

  // The iframe is outside React's tree, so its accessible name is set here
  // rather than rendered — and only when it actually changes.
  useEffect(() => {
    if (iframeRef.current) iframeRef.current.title = title ?? "Stream";
  }, [title]);

  // The clock.
  //
  // A live stream's duration does NOT keep growing — measured against real
  // embeds it does not move at all, and it routinely sits an hour ahead of the
  // playhead. `lib/player-time` carries the measurement and the reasoning; the
  // upshot here is that the live edge is measured from the playhead against a
  // monotonic clock, and `getDuration()` is only believed for a recording.
  //
  // Everything this tick needs, it reads or derives inside the tick. The effect
  // is deliberately kept on `[ready, live]` deps, so anything read out of render
  // scope would be frozen at the value it had when the timer was built — which
  // is exactly how the old `narrowDvr` call came to be fed a raw duration.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;

      const reported = p.getDuration();
      const current = p.getCurrentTime();
      const now = performance.now();
      const states = window.YT?.PlayerState;
      const state = p.getPlayerState();
      if (isFiniteNumber(reported) && reported > 0) setDuration(reported);

      // Is a seek still in flight? Until the player has actually moved, its
      // clock still reads the old time — so nothing may be read off it.
      const aim = seekAimRef.current;
      const age = aim === null ? 0 : now - aim.at;
      const landed = aim === null || !isFiniteNumber(current) || Math.abs(current - aim.target) < 2;
      const pending = aim !== null && !landed && age < SEEK_ABANDON_MS;

      if (isFiniteNumber(current) && !pending) setPosition(current);

      let lag = lagRef.current;
      if (live && isFiniteNumber(current) && !pending) {
        // The play state is read off the player, not off our `phase` state, for
        // the same stale-closure reason as everything else in here.
        const moving = Boolean(
          states && (state === states.PLAYING || state === states.BUFFERING),
        );

        // A stall is not a pause: the viewer keeps falling behind through it,
        // and the readout should say so — so BUFFERING samples count too. They
        // cannot corrupt the live-edge floor, because a frozen playhead under a
        // running clock only ever pushes slack *up*, and the floor is a minimum.
        if (moving) {
          lag = trackLag(lag, now / 1000, current);
          lagRef.current = lag;
        }
        // Rounded, so a number that hasn't meaningfully changed doesn't re-render
        // the whole player four times a second.
        const next = Math.round(lagBehind(lag));
        setBehind((prev) => (prev === next ? prev : next));
      }

      // A seek that lands well ahead of where it was aimed means the DVR
      // window is shorter than we were offering. Believe the stream — but only
      // once it has settled, so a burst of presses is judged once rather than
      // measured against a position none of them had reached yet.
      const settled = Boolean(states && state === states.PLAYING) && age >= SEEK_SETTLE_MS;
      if (live && aim !== null && isFiniteNumber(current) && (settled || age >= SEEK_ABANDON_MS)) {
        seekAimRef.current = null;
        if (settled) {
          const edgeNow = liveEdge({
            live,
            duration: reported,
            position: current,
            behind: lagBehind(lag),
          });
          setDvrSeconds((prev) =>
            narrowDvr({ dvrSeconds: prev, requested: aim.target, landed: current, edge: edgeNow }),
          );
        }
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [ready, live]);

  // Autoplay refused, or just very slow? After the grace window, say so and
  // point at the play button — there is no event for "never started".
  useEffect(() => {
    if (hasPlayed) {
      setStalled(false);
      return;
    }
    const id = setTimeout(() => setStalled(true), AUTOPLAY_GRACE_MS);
    return () => clearTimeout(id);
  }, [hasPlayed]);

  // Fullscreen: is it even available, and are we in it right now?
  useEffect(() => {
    const doc = document as FullscreenDocument;
    const shell = shellRef.current as FullscreenCapable | null;
    setFsSupported(
      Boolean(doc.fullscreenEnabled && shell?.requestFullscreen) ||
        Boolean(shell?.webkitRequestFullscreen),
    );

    function sync() {
      const active = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      setFullscreen(Boolean(active && shellRef.current && active === shellRef.current));
    }
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const edge = liveEdge({ live, duration, position, behind });
  const liveWin = seekWindow({ edge, isLive: live, dvrSeconds });
  // A drag holds the window it started on. `win` is derived from `position`,
  // which keeps advancing during playback, so an unfrozen window slides under
  // the finger at a second per second — and a finger that has stopped moving
  // fires no pointer event, so nothing recomputes and the knob drifts backwards
  // on its own. Against a window `narrowDvr` has shrunk to its 60s floor that
  // is an 8% error on a five-second drag.
  const win = scrub !== null && dragWinRef.current ? dragWinRef.current : liveWin;
  // Clamped: the polled clock can read a second or two past the duration
  // YouTube reports, and a readout beyond the end reads as a bug.
  const shown = clamp(scrub ?? position, win.start, win.end);
  const fraction = fractionOf(shown, win);
  const behindEdge = live && !atLiveEdge(shown, edge);
  const seekable = ready && !failure && win.end - win.start > 1;
  // Tally red means one thing on this site: live, right now. A recording's
  // progress, and a live stream you have rewound out of, are amber.
  const lineTone = live && !behindEdge ? "bg-tally" : "bg-amber";

  // The whole picture-cover decision, in one place and one call.
  const cover = pictureCover({ phase, hasPlayed, failure: Boolean(failure) });
  // "Press play" is only honest advice once there is a play button that
  // works — before `ready` the transport is disabled and the wait is ours.
  const label = coverLabel({ phase, hasPlayed, failure, stalled: stalled && ready });

  const seek = useCallback((seconds: number) => {
    const p = playerRef.current;
    if (!p) return;
    const target = Math.max(0, seconds);
    // Where we are *for the purposes of this seek*: a seek still in flight has
    // already moved the readout, and the player's own clock has not caught up
    // yet, so chaining off the last aim is what makes a burst of presses add up
    // instead of each one re-measuring from the same stale place.
    const previous = seekAimRef.current;
    const from = previous ? previous.target : p.getCurrentTime();
    seekAimRef.current = { target, at: performance.now() };
    p.seekTo(target, true);
    setPosition(target);
    // Move the lag with the intent. On a live stream `position` cancels out of
    // the bar's fill — what the bar shows is how far back in the window you
    // are — so moving the playhead alone moves nothing on screen, and the knob
    // would sit frozen through the buffering that follows and then jump.
    if (isFiniteNumber(from)) {
      const next = shiftLag(lagRef.current, from - target);
      lagRef.current = next;
      setBehind(Math.round(lagBehind(next)));
    }
  }, []);

  const nudge = useCallback(
    (delta: number) => {
      if (!seekable) return;
      seek(Math.min(win.end, Math.max(win.start, (scrub ?? position) + delta)));
    },
    [seekable, seek, win.end, win.start, scrub, position],
  );

  // A chapter mark, arriving from the description underneath. Clamped to the
  // window exactly as `nudge` is — a live stream's DVR does not reach back to
  // the 4:12 of a broadcast that has been running for six hours, and asking it
  // to is how you get a seek that never lands. Played as well as sought,
  // because the reader asked to be taken somewhere, and a paused player parked
  // on a new frame looks like the click did nothing.
  const seekTo = useCallback(
    (seconds: number) => {
      if (!seekable) return;
      seek(Math.min(win.end, Math.max(win.start, seconds)));
      playerRef.current?.playVideo();
    },
    [seekable, seek, win.end, win.start],
  );

  useImperativeHandle(ref, () => ({ seekTo }), [seekTo]);

  const toggle = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (playing) p.pauseVideo();
    else p.playVideo();
  }, [playing]);

  const toggleMute = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isMuted()) {
      p.unMute();
      if (p.getVolume() === 0) {
        p.setVolume(100);
        setVolume(100);
      }
      setMuted(false);
    } else {
      p.mute();
      setMuted(true);
    }
  }, []);

  const goLive = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    const from = seekAimRef.current?.target ?? p.getCurrentTime();
    if (!isFiniteNumber(from)) return;
    // Forward by exactly the offset we have measured. Landing exactly on the
    // edge can trip ENDED — which would put the slate over live footage — so
    // stop just short of it, as this has always done.
    const target = Math.max(0, from + lagBehind(lagRef.current) - 2);
    seekAimRef.current = null;
    p.seekTo(target, true);
    p.playVideo();
    setPosition(target);
    // Re-baseline rather than trusting the seek to land on the floor. A resync
    // on a normal-latency stream routinely settles ten or twenty seconds back,
    // and a Live button that stays lit after being pressed invites a re-seek
    // loop, each one costing a rebuffer.
    lagRef.current = null;
    setBehind(0);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const doc = document as FullscreenDocument;
    const shell = shellRef.current as FullscreenCapable | null;
    if (!shell) return;

    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      const exit = doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc);
      // A rejected exit is not worth an unhandled rejection in the console.
      void Promise.resolve(exit?.()).catch(() => {});
      return;
    }
    if (shell.requestFullscreen) {
      void shell.requestFullscreen().catch(() => {});
    } else {
      shell.webkitRequestFullscreen?.();
    }
    // Once we're in, keys should reach us rather than the cross-origin iframe.
    shell.focus?.();
  }, []);

  /**
   * Clicking the picture.
   *
   * A double-click fires `click`, `click`, `dblclick` — not `click`, `dblclick`
   * — and both of those clicks are dispatched before React re-renders, so both
   * read the same stale `playing` and would issue the *same* command twice
   * (`pauseVideo()` twice, not pause-then-play). So the toggle is held for a
   * beat and cancelled if a second click lands, rather than fired and undone.
   *
   * That beat is only spent where it buys something. Touch has no reliable
   * `dblclick` at all, so a tap toggles immediately and fullscreen is reached
   * the way it is on every phone — by the button in the strip below, which is
   * rendered whenever fullscreen is available.
   */
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coarsePointer = useRef(false);

  useEffect(
    () => () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    },
    [],
  );

  const onPictureClick = useCallback(
    (e: React.MouseEvent) => {
      if (!ready || failure) return;
      if (coarsePointer.current || !fsSupported) {
        toggle();
        return;
      }
      // Ignore the second click of a burst outright; the first one is already
      // waiting on the timer below and `dblclick` is about to cancel it.
      if (e.detail > 1) return;
      if (clickTimer.current) clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        toggle();
      }, 220);
    },
    [ready, failure, fsSupported, toggle],
  );

  const onPictureDoubleClick = useCallback(() => {
    if (coarsePointer.current || !fsSupported) return;
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    toggleFullscreen();
  }, [fsSupported, toggleFullscreen]);

  // Pointer scrubbing. Pointer capture keeps the drag alive off the bar.
  const barRef = useRef<HTMLDivElement>(null);

  const fractionAt = useCallback((clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return fractionFromPointer(clientX, rect);
  }, []);

  function onBarPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!seekable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Hold this window for the whole gesture, release included.
    dragWinRef.current = win;
    setScrub(positionAt(fractionAt(e.clientX), win));
  }

  function onBarPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (scrub !== null) {
      setScrub(positionAt(fractionAt(e.clientX), win));
      return;
    }
    // Hover is a mouse idea. A finger dragging past the bar must not leave a
    // readout stranded on it.
    if (e.pointerType === "mouse" && seekable) setHover(fractionAt(e.clientX));
  }

  function onBarPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (scrub === null) return;
    const target = positionAt(fractionAt(e.clientX), dragWinRef.current ?? win);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragWinRef.current = null;
    setScrub(null);
    seek(target);
    // Scrubbing a paused picture is how you study a frame now that there is
    // one to study — so only a player that was already running resumes.
    if (playing) playerRef.current?.playVideo();
  }

  function onBarKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!seekable) return;
    const step = e.shiftKey ? 60 : 10;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      nudge(-step);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      nudge(step);
    } else if (e.key === "Home") {
      e.preventDefault();
      seek(win.start);
    } else if (e.key === "End") {
      e.preventDefault();
      goLive();
    }
  }

  // Shortcuts, scoped to the player so they never hijack the page — and note
  // that once focus is inside the iframe, no key reaches us at all.
  function onShellKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    if (typing) return;
    // Space on a focused control already activates it; don't double-fire.
    const onControl = Boolean(el?.closest("button,[role=slider]"));

    if (e.code === "Space" && !onControl) {
      e.preventDefault();
      toggle();
    } else if (e.key.toLowerCase() === "m") {
      toggleMute();
    } else if (e.key.toLowerCase() === "f" && fsSupported) {
      e.preventDefault();
      toggleFullscreen();
    }
  }

  // One metric for every control in the strip: 32px tall, one border, one
  // hover. Before this, six buttons had five different heights because each
  // one was sized by whatever glyph or word happened to be inside it.
  const ctl =
    "inline-flex h-8 items-center justify-center border border-edge text-muted transition-colors hover:border-amber hover:text-amber disabled:cursor-not-allowed disabled:border-edge-soft disabled:text-faint disabled:hover:border-edge-soft disabled:hover:text-faint";
  const ctlIcon = `${ctl} w-8`;
  const ctlText = `${ctl} gap-1.5 px-2.5 font-mono text-[10px] tracking-[0.1em] uppercase`;

  const volumeLevel = muted || volume === 0 ? "muted" : volume < 50 ? "low" : "high";
  const hoverAt = hover === null ? null : positionAt(hover, win);

  return (
    // tabIndex -1 only makes the shell programmatically focusable, so our
    // shortcuts have somewhere to land once a control has been used.
    <section
      ref={shellRef}
      aria-label={title ? `Player — ${title}` : "Player"}
      tabIndex={-1}
      onKeyDown={onShellKeyDown}
      className="player-shell outline-none"
    >
      {/* Our title, above the picture — never on it. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border border-b-0 border-edge-soft bg-ink-2 px-3 py-2.5">
        {live && <LiveBadge />}
        <h1 className="min-w-0 flex-1 truncate font-display text-[15px] leading-tight font-semibold text-bone sm:text-base">
          {title ?? "Loading…"}
        </h1>
        {channel && (
          <span className="shrink-0 truncate font-mono text-[11px] text-muted">{channel}</span>
        )}
      </header>

      <div className="player-frame relative aspect-video overflow-hidden border border-edge-soft bg-black">
        {/* The IFrame API mutates this node's children, so React must own
            nothing inside it — anything else here belongs to the box above. */}
        {/* The descendant rule stays even though the iframe is built with its
            own classes: it is what guarantees the size if the API ever swaps
            the node out from under us. */}
        <div ref={frameRef} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />

        {/* YouTube's own chrome — the title bar, avatar, share, watch-later,
            end-screen grid — is painted inside a cross-origin iframe, so it
            cannot be removed; it can only be kept from ever being summoned.
            It surfaces on hover and on click inside the frame, and this
            swallows both.

            It is also the play/pause target, because a picture you cannot
            click is the thing every viewer tries first. Deliberately
            `aria-hidden` and out of the tab order: the labelled transport
            button below is the accessible control, and two focusable
            same-named play buttons is worse for a screen reader than one. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onPointerDown={(e) => {
            coarsePointer.current = e.pointerType !== "mouse";
          }}
          onClick={onPictureClick}
          onDoubleClick={onPictureDoubleClick}
          className="absolute inset-0 h-full w-full cursor-default touch-manipulation border-0 bg-transparent outline-none"
        />

        {/* Before there is a decoded frame, the video's own poster stands in.
            Never a black box — that was the whole complaint. It stays mounted
            and fades, so the hand-off to the first decoded frame is a
            dissolve rather than a flash of whatever is underneath. */}
        {/* A plain img, not next/image: i.ytimg.com is remote and would need
            an images.remotePatterns entry — its own decision, not this one.
            Biome already allows it (performance/noImgElement is off). */}
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          fetchPriority="high"
          decoding="async"
          onError={() => setPoster(posterFallbackUrl(videoId))}
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
            cover === "poster" ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Nothing is laid over the picture. YouTube's own chrome used to be
            answered here with scrims and a disc; measuring it with the cover
            switched off showed a pause raises no chrome whatsoever, and that
            everything a resume or a seek does raise fades itself out inside
            three seconds. The cover was the artificial part — heavier than
            what it hid, and up for longer. See `YT_CHROME_MS`. */}

        {/* A full cover survives in exactly two places, and both are places
            where there is no footage underneath worth keeping: a refusal, and
            the end-screen grid of suggestions. */}
        {cover === "slate" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-ink px-6">
            <span className="text-center font-mono text-[11px] leading-relaxed tracking-[0.14em] text-faint uppercase">
              {label}
            </span>
          </div>
        )}

        {/* State is reported in a corner, the way a monitor tags its own feed
            — never as a screen over the picture. */}
        {label && cover !== "slate" && (
          <span
            aria-live="polite"
            className="pointer-events-none absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 border border-edge bg-ink/85 px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-bone uppercase backdrop-blur-[2px]"
          >
            {live && !behindEdge && <span className="h-1 w-1 rounded-full bg-tally" />}
            {label}
          </span>
        )}
      </div>

      {/* Everything else, underneath. */}
      <div className="player-controls border border-t-0 border-edge-soft bg-ink-2">
        {/* The line. Drag it back through the stream, or forward again. */}
        <div className="flex items-center gap-3 px-3 pt-3">
          <span className="w-14 shrink-0 font-mono text-[10px] text-faint tabular-nums">
            {clock(live ? Math.max(0, shown - win.start) : shown)}
          </span>

          {/* A div rather than a range input: the bar has to paint the live
              edge, the window behind it and where the cursor is pointing,
              none of which an input can carry. `touch-none` is load-bearing —
              without it a drag on a phone scrolls the page instead. */}
          <div
            ref={barRef}
            role="slider"
            tabIndex={seekable ? 0 : -1}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(win.end - win.start)}
            aria-valuenow={Math.round(Math.max(0, shown - win.start))}
            aria-valuetext={live ? liveOffsetLabel(shown, edge) : clock(shown)}
            aria-disabled={!seekable}
            onPointerDown={onBarPointerDown}
            onPointerMove={onBarPointerMove}
            onPointerUp={onBarPointerUp}
            onPointerCancel={onBarPointerUp}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onBarKeyDown}
            className={`group relative -my-2 flex h-8 flex-1 touch-none items-center ${
              seekable ? "cursor-pointer" : "cursor-default opacity-50"
            }`}
          >
            {/* What is under the cursor, before you commit to it. */}
            {hoverAt !== null && scrub === null && (
              <span
                className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 border border-edge bg-ink px-1.5 py-0.5 font-mono text-[10px] text-bone tabular-nums"
                style={{ left: `${(hover ?? 0) * 100}%` }}
              >
                {live ? liveOffsetLabel(hoverAt, edge) : clock(hoverAt)}
              </span>
            )}

            <div className="relative h-[3px] w-full bg-edge transition-all duration-150 group-hover:h-[5px]">
              {/* A ghost out to the cursor, so the bar answers before the click. */}
              {hover !== null && scrub === null && (
                <div
                  className="absolute inset-y-0 left-0 bg-bone/20"
                  style={{ width: `${hover * 100}%` }}
                />
              )}
              <div
                className={`absolute inset-y-0 left-0 ${lineTone}`}
                style={{ width: `${fraction * 100}%` }}
              />
              {/* The knob keeps out of the way until it is wanted. */}
              <span
                className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-2 transition-opacity duration-150 ${lineTone} ${
                  scrub !== null
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                }`}
                style={{ left: `${fraction * 100}%` }}
              />
            </div>
          </div>

          <span
            className={`w-16 shrink-0 text-right font-mono text-[10px] tabular-nums ${
              live ? (behindEdge ? "text-amber" : "text-tally") : "text-faint"
            }`}
          >
            {live ? liveOffsetLabel(shown, edge) : clock(win.end)}
          </span>
        </div>

        {/* Grouped, not strung out: transport, then sound, then — pushed to
            the far end — the two controls that change what you are looking
            at rather than what is playing. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-2.5 pb-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggle}
              disabled={!ready || Boolean(failure)}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause (Space)" : "Play (Space)"}
              className={`${ctlIcon} text-bone`}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>

            <button
              type="button"
              onClick={() => nudge(-10)}
              disabled={!seekable}
              aria-label="Back 10 seconds"
              title="Back 10 seconds (←)"
              className={ctlText}
            >
              <BackIcon size={13} />
              10s
            </button>

            <button
              type="button"
              onClick={() => nudge(10)}
              disabled={!seekable || (live && !behindEdge)}
              aria-label="Forward 10 seconds"
              title="Forward 10 seconds (→)"
              className={ctlText}
            >
              <ForwardIcon size={13} />
              10s
            </button>
          </div>

          <div className="flex items-center gap-2 border-l border-edge-soft pl-3">
            <button
              type="button"
              onClick={toggleMute}
              disabled={!ready || Boolean(failure)}
              aria-label={muted ? "Unmute" : "Mute"}
              aria-pressed={muted}
              title={muted ? "Unmute (M)" : "Mute (M)"}
              className={`${ctlIcon} ${
                // Muted is the state worth shouting about: autoplay forces it,
                // and a viewer who doesn't notice thinks the stream is silent.
                muted ? "border-amber text-amber hover:bg-amber hover:text-ink" : ""
              }`}
            >
              <VolumeIcon level={volumeLevel} />
            </button>

            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              disabled={!ready || Boolean(failure)}
              aria-label="Volume"
              // WebKit can't paint a range's filled track; the stylesheet
              // reads this to do it by hand.
              style={{ "--vol": `${muted ? 0 : volume}%` } as React.CSSProperties}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                playerRef.current?.setVolume(v);
                if (v > 0 && muted) {
                  playerRef.current?.unMute();
                  setMuted(false);
                }
                if (v === 0 && !muted) {
                  playerRef.current?.mute();
                  setMuted(true);
                }
              }}
              className="volume-range w-20 sm:w-24"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            {live && behindEdge && (
              <button
                type="button"
                onClick={goLive}
                title="Jump to the live edge (End)"
                className={`${ctlText} border-tally text-tally hover:border-tally hover:bg-tally hover:text-ink`}
              >
                <LiveEdgeIcon size={13} />
                Live
              </button>
            )}

            {fsSupported && (
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-pressed={fullscreen}
                aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                title={fullscreen ? "Exit full screen (F)" : "Full screen (F)"}
                className={ctlIcon}
              >
                {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
