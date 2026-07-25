"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LiveBadge } from "@/components/ui/bits";
import {
  atLiveEdge,
  clock,
  DEFAULT_DVR_SECONDS,
  fractionFromPointer,
  fractionOf,
  isFiniteNumber,
  liveOffsetLabel,
  narrowDvr,
  positionAt,
  seekWindow,
} from "@/lib/player-time";

/**
 * A clean picture.
 *
 * YouTube's own control bar is turned off (`controls=0`) and we drive playback
 * through the IFrame Player API instead. Every control — the title, the
 * scrubber, play/pause, volume, fullscreen — is our own markup, and all of it
 * lives in siblings *outside* the frame: the picture itself is never covered.
 *
 * What is deliberately *not* done: the player's branding is not covered or
 * removed, and nothing is drawn over the frame. YouTube's title and logo still
 * appear if you hover the picture — that's their attribution, and hiding it is
 * both against their terms and the thing that keeps carrying other people's
 * streams defensible.
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
  const playerRef = useRef<Player | null>(null);

  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(100);

  // Playback clock, polled — never read during render from the player itself.
  const [position, setPosition] = useState(0);
  const [edge, setEdge] = useState(0);
  const [dvrSeconds, setDvrSeconds] = useState(DEFAULT_DVR_SECONDS);

  // While a finger is down the bar follows the finger, not the poll.
  const [scrub, setScrub] = useState<number | null>(null);
  const seekAimRef = useRef<number | null>(null);

  const [fullscreen, setFullscreen] = useState(false);
  const [fsSupported, setFsSupported] = useState(false);

  const live = isLive === true;

  useEffect(() => {
    const host = frameRef.current;
    if (!host) return;

    let cancelled = false;
    let player: Player | null = null;

    // The IFrame API *replaces* the node it is handed with an iframe, so it
    // must never be given a React-owned element: hand it a throwaway child of
    // a stable host instead. (Doing otherwise detaches the ref — which is what
    // used to leave the fullscreen button with nothing to ask.)
    const mount = document.createElement("div");
    host.appendChild(mount);

    setReady(false);
    setFailure("");
    setPosition(0);
    setEdge(0);
    setDvrSeconds(DEFAULT_DVR_SECONDS);

    loadApi().then(() => {
      if (cancelled || !window.YT) return;
      player = new window.YT.Player(mount, {
        videoId,
        playerVars: {
          controls: 0,
          rel: 0,
          iv_load_policy: 3,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          autoplay: 1,
          mute: 1,
          start: start ?? 0,
          origin: window.location.origin,
        },
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
            // Buffering is still "playing" as far as the button is concerned —
            // otherwise every seek flickers the icon back to play.
            setPlaying(e.data === s.PLAYING || e.data === s.BUFFERING);
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
      // destroy() takes the iframe with it; this clears anything it left.
      host.replaceChildren();
    };
  }, [videoId, start]);

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
  const shown = scrub ?? position;
  const fraction = fractionOf(shown, win);
  const behindEdge = live && !atLiveEdge(shown, edge);
  const seekable = ready && !failure && win.end - win.start > 1;

  const seek = useCallback(
    (seconds: number) => {
      const p = playerRef.current;
      if (!p) return;
      const target = Math.max(0, seconds);
      seekAimRef.current = target;
      p.seekTo(target, true);
      setPosition(target);
    },
    [],
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
    // Landing exactly on the edge can trip ENDED; stop just short of it.
    const target = Math.max(0, (isFiniteNumber(edge) && edge > 0 ? edge : p.getDuration()) - 2);
    seekAimRef.current = null;
    p.seekTo(target, true);
    p.playVideo();
    setPosition(target);
  }, [edge]);

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
    playerRef.current?.playVideo();
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

      <div
        ref={frameRef}
        className="player-frame relative aspect-video border border-edge-soft bg-black [&>iframe]:h-full [&>iframe]:w-full"
      >
        {/* Status text only — no control ever sits over the frame. */}
        {(!ready || failure) && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-6">
            <span className="text-center font-mono text-[11px] leading-relaxed tracking-[0.14em] text-faint uppercase">
              {failure || "Connecting…"}
            </span>
          </div>
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
                className={`absolute inset-y-0 left-0 ${behindEdge ? "bg-amber" : "bg-tally"}`}
                style={{ width: `${fraction * 100}%` }}
              />
              <span
                className={`absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 transition-transform group-hover:scale-y-125 ${
                  behindEdge ? "bg-amber" : "bg-tally"
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
