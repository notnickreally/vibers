"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  liveOffsetLabel,
  narrowDvr,
  type Phase,
  pictureCover,
  positionAt,
  seekWindow,
  YT_CHROME_MS,
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
 * never appears at all. What the shield cannot reach is the chrome a *state
 * change* raises: a resume or a seek puts it up for about four seconds, and a
 * pause puts it up until playback resumes.
 *
 * This used to be answered by blacking the whole frame out, which meant a
 * paused stream was a black rectangle and a loading one was four seconds of
 * nothing. It is now answered by covering only where YouTube actually paints —
 * a title-bar gradient across the top and a disc over the centre carrying our
 * own state glyph — so a paused picture stays a picture. Before there is any
 * decoded frame at all, the video's poster stands in. A full slate survives in
 * exactly two places, where there is no footage left to protect: a refusal,
 * and the end-screen grid. `pictureCover` in `lib/player-time` is that whole
 * decision, and it is where to change it.
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

/** What YouTube says when it won't be embedded — worth saying plainly. */
const EMBED_REFUSED = new Set([101, 150]);

export function CleanPlayer({
  videoId,
  start,
  isLive,
  title,
  channel,
}: {
  videoId: string;
  start?: number;
  /** Only true when YouTube confirmed it. Gates the live-edge controls. */
  isLive?: boolean;
  /** Shown in our own title strip above the picture. */
  title?: string;
  channel?: string;
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
  const [edge, setEdge] = useState(0);
  const [dvrSeconds, setDvrSeconds] = useState(DEFAULT_DVR_SECONDS);

  // While a finger is down the bar follows the finger, not the poll.
  const [scrub, setScrub] = useState<number | null>(null);
  const seekAimRef = useRef<number | null>(null);

  // The settling window. A resume or a seek raises YouTube's chrome for about
  // four seconds and it cannot be dismissed from out here, so the mask is held
  // over that window even while the picture is running. Calling `coverChrome`
  // again restarts it.
  const [settling, setSettling] = useState(false);
  const [settleUntil, setSettleUntil] = useState(0);
  const coverChrome = useCallback(() => {
    setSettling(true);
    // Event handler, not render — the no-clock-during-render rule holds.
    setSettleUntil(Date.now() + YT_CHROME_MS);
  }, []);

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
    setEdge(0);
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

  // The clock. A live stream's duration keeps growing, and that growing number
  // is the only live edge YouTube exposes — so remember the furthest we've seen.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;

      const duration = p.getDuration();
      const current = p.getCurrentTime();
      if (isFiniteNumber(duration) && duration > 0) {
        setEdge((prev) => (live ? Math.max(prev, duration) : duration));
      }
      if (isFiniteNumber(current)) setPosition(current);

      // A seek that lands well ahead of where it was aimed means the DVR
      // window is shorter than we were offering. Believe the stream.
      const aim = seekAimRef.current;
      if (live && aim !== null && isFiniteNumber(current) && isFiniteNumber(duration)) {
        seekAimRef.current = null;
        setDvrSeconds((prev) =>
          narrowDvr({ dvrSeconds: prev, requested: aim, landed: current, edge: duration }),
        );
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [ready, live]);

  // Close the settling window when it actually elapses.
  //
  // The old shape of this was `Math.max(0, coverUntil - Date.now()) ||
  // YT_CHROME_MS`, which on a cold start (`coverUntil === 0`) evaluates to
  // `0 || 4000` — a full four-second hold on every fresh page load for a
  // state change nobody asked for. That accident was most of the "loading
  // takes a while" in this ticket. Clamp; never coalesce on zero.
  useEffect(() => {
    if (!settling) return;
    const id = setTimeout(() => setSettling(false), Math.max(0, settleUntil - Date.now()));
    return () => clearTimeout(id);
  }, [settling, settleUntil]);

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

  const win = seekWindow({ edge, isLive: live, dvrSeconds });
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
  const cover = pictureCover({ phase, hasPlayed, settling, failure: Boolean(failure) });
  // "Press play" is only honest advice once there is a play button that
  // works — before `ready` the transport is disabled and the wait is ours.
  const label = coverLabel({ phase, hasPlayed, failure, stalled: stalled && ready });

  const seek = useCallback(
    (seconds: number) => {
      const p = playerRef.current;
      if (!p) return;
      const target = Math.max(0, seconds);
      seekAimRef.current = target;
      coverChrome();
      p.seekTo(target, true);
      setPosition(target);
    },
    [coverChrome],
  );

  const nudge = useCallback(
    (delta: number) => {
      if (!seekable) return;
      seek(Math.min(win.end, Math.max(win.start, (scrub ?? position) + delta)));
    },
    [seekable, seek, win.end, win.start, scrub, position],
  );

  const toggle = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    // Cover the picture before asking, not after: YouTube paints its chrome
    // the moment the state changes, ahead of any event reaching us.
    coverChrome();
    if (playing) p.pauseVideo();
    else p.playVideo();
  }, [playing, coverChrome]);

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
    // Landing exactly on the edge can trip ENDED; stop just short of it.
    const target = Math.max(0, (isFiniteNumber(edge) && edge > 0 ? edge : p.getDuration()) - 2);
    seekAimRef.current = null;
    coverChrome();
    p.seekTo(target, true);
    p.playVideo();
    setPosition(target);
  }, [edge, coverChrome]);

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
    setScrub(positionAt(fractionAt(e.clientX), win));
  }

  function onBarPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (scrub === null) return;
    setScrub(positionAt(fractionAt(e.clientX), win));
  }

  function onBarPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (scrub === null) return;
    const target = positionAt(fractionAt(e.clientX), win);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
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

  const buttonBase =
    "border border-edge font-mono uppercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

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
            swallows both. Not a control: it shows nothing and does nothing. */}
        <div className="absolute inset-0 cursor-default" aria-hidden="true" />

        {/* Before there is a decoded frame, the video's own poster stands in.
            Never a black box — that was the whole complaint. */}
        {cover === "poster" && (
          /* A plain img, not next/image: i.ytimg.com is remote and would need
             an images.remotePatterns entry — its own decision, not this one.
             Biome already allows it (performance/noImgElement is off). */
          <img
            src={poster}
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            decoding="async"
            onError={() => setPoster(posterFallbackUrl(videoId))}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
        )}

        {/* The mask. Two rectangles, covering exactly where YouTube paints —
            its title bar across the top and its state disc in the middle —
            and nothing else, so the frozen frame stays a frame. The disc
            carries our own glyph, which is what keeps it reading as the
            player's own furniture rather than a patch over a hole. */}
        {cover === "mask" && (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div
              className="absolute inset-x-0 top-0 h-[17%]"
              style={{
                background:
                  "linear-gradient(to bottom, var(--color-ink) 0%, color-mix(in srgb, var(--color-ink) 92%, transparent) 45%, transparent 100%)",
              }}
            />
            <div
              className="absolute top-1/2 left-1/2 grid aspect-square w-[22%] max-w-[140px] min-w-[64px] -translate-x-1/2 -translate-y-1/2 place-items-center"
              style={{
                background:
                  "radial-gradient(circle, var(--color-ink) 0 58%, color-mix(in srgb, var(--color-ink) 86%, transparent) 74%, transparent 100%)",
              }}
            >
              <span className="font-mono text-[15px] text-bone">
                {phase === "paused" ? "❚❚" : "▶"}
              </span>
            </div>
          </div>
        )}

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
            className="pointer-events-none absolute bottom-2.5 left-2.5 border border-edge bg-ink/85 px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-bone uppercase backdrop-blur-[2px]"
          >
            {label}
          </span>
        )}
      </div>

      {/* Everything else, underneath. */}
      <div className="border border-t-0 border-edge-soft bg-ink-2">
        {/* The line. Drag it back through the stream, or forward again. */}
        <div className="flex items-center gap-3 px-3 pt-2.5">
          <span className="w-14 shrink-0 font-mono text-[10px] text-faint tabular-nums">
            {clock(live ? Math.max(0, shown - win.start) : shown)}
          </span>

          {/* A div rather than a range input: the bar has to paint the live
              edge and the window behind it, which an input can't carry. */}
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
            onKeyDown={onBarKeyDown}
            className={`group relative -my-2 flex h-8 flex-1 items-center ${
              seekable ? "cursor-pointer" : "cursor-default opacity-50"
            }`}
          >
            <div className="relative h-[3px] w-full bg-edge">
              <div
                className={`absolute inset-y-0 left-0 ${lineTone}`}
                style={{ width: `${fraction * 100}%` }}
              />
              <span
                className={`absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 transition-transform group-hover:scale-y-125 ${
                  lineTone
                } ${scrub !== null ? "scale-y-150" : ""}`}
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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-2 pb-2.5">
          <button
            type="button"
            onClick={toggle}
            disabled={!ready || Boolean(failure)}
            aria-label={playing ? "Pause" : "Play"}
            aria-pressed={playing}
            className={`${buttonBase} w-9 py-1.5 text-[11px] text-bone hover:border-amber hover:text-amber`}
          >
            {playing ? "❚❚" : "▶"}
          </button>

          <button
            type="button"
            onClick={() => nudge(-10)}
            disabled={!seekable}
            aria-label="Back 10 seconds"
            className={`${buttonBase} px-2.5 py-1.5 text-[10px] tracking-[0.1em] text-muted hover:text-bone`}
          >
            ‹‹ 10s
          </button>

          <button
            type="button"
            onClick={() => nudge(10)}
            disabled={!seekable || (live && !behindEdge)}
            aria-label="Forward 10 seconds"
            className={`${buttonBase} px-2.5 py-1.5 text-[10px] tracking-[0.1em] text-muted hover:text-bone`}
          >
            10s ››
          </button>

          <button
            type="button"
            onClick={toggleMute}
            disabled={!ready || Boolean(failure)}
            className={`border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors disabled:opacity-40 ${
              muted
                ? "border-amber text-amber hover:bg-amber hover:text-ink"
                : "border-edge text-muted hover:text-bone"
            }`}
          >
            {muted ? "Unmute" : "Mute"}
          </button>

          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            disabled={!ready || Boolean(failure)}
            aria-label="Volume"
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              playerRef.current?.setVolume(v);
              if (v > 0 && muted) {
                playerRef.current?.unMute();
                setMuted(false);
              }
            }}
            className="h-1 w-24 accent-[var(--color-amber)]"
          />

          {live && behindEdge && (
            <button
              type="button"
              onClick={goLive}
              className="border border-tally px-2.5 py-1.5 font-mono text-[10px] tracking-[0.12em] text-tally uppercase transition-colors hover:bg-tally hover:text-ink"
            >
              Jump to live
            </button>
          )}

          {fsSupported && (
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-pressed={fullscreen}
              className={`${buttonBase} ml-auto px-2.5 py-1.5 text-[10px] tracking-[0.1em] text-muted hover:text-bone`}
            >
              {fullscreen ? "Exit full screen" : "Fullscreen"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
