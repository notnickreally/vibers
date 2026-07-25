"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A clean picture.
 *
 * YouTube's own control bar is turned off (`controls=0`) and we drive playback
 * through the IFrame Player API instead, rendering our controls underneath. So
 * the frame is just the video, and everything a viewer needs sits below it in
 * this site's own language.
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
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => Player;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
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

export function CleanPlayer({
  videoId,
  start,
  isLive,
}: {
  videoId: string;
  start?: number;
  /** Only true when YouTube confirmed it. Gates the live-edge control. */
  isLive?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(100);
  const [atLiveEdge, setAtLiveEdge] = useState(true);

  useEffect(() => {
    let cancelled = false;

    loadApi().then(() => {
      if (cancelled || !mountRef.current || !window.YT) return;
      playerRef.current = new window.YT.Player(mountRef.current, {
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
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            setReady(true);
            setVolume(playerRef.current?.getVolume() ?? 100);
          },
          onStateChange: (e: { data: number }) => {
            if (cancelled || !window.YT) return;
            setPlaying(e.data === window.YT.PlayerState.PLAYING);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId, start]);

  // A live stream's duration keeps growing; if we're near the end we're live.
  useEffect(() => {
    if (!ready || !isLive) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      const d = p.getDuration();
      setAtLiveEdge(d === 0 || d - p.getCurrentTime() < 12);
    }, 2000);
    return () => clearInterval(id);
  }, [ready, isLive]);

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
      setMuted(false);
    } else {
      p.mute();
      setMuted(true);
    }
  }, []);

  function goLive() {
    const p = playerRef.current;
    if (!p) return;
    p.seekTo(p.getDuration(), true);
    p.playVideo();
  }

  function fullscreen() {
    mountRef.current?.parentElement?.requestFullscreen?.();
  }

  // Space and M, the two shortcuts anyone actually uses.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      }
      if (e.key.toLowerCase() === "m") toggleMute();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, toggleMute]);

  return (
    <div>
      <div className="relative aspect-video border border-edge-soft bg-black">
        <div ref={mountRef} className="absolute inset-0 h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />
        {!ready && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="font-mono text-[11px] tracking-[0.18em] text-faint uppercase">
              Connecting…
            </span>
          </div>
        )}
      </div>

      {/* Our controls, under the picture. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-t-0 border-edge-soft bg-ink-2 px-3 py-2">
        <button
          type="button"
          onClick={toggle}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
          className="w-9 border border-edge py-1.5 font-mono text-[11px] text-bone transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <button
          type="button"
          onClick={toggleMute}
          disabled={!ready}
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
          disabled={!ready}
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

        {isLive && !atLiveEdge && (
          <button
            type="button"
            onClick={goLive}
            className="border border-tally px-2.5 py-1.5 font-mono text-[10px] tracking-[0.12em] text-tally uppercase transition-colors hover:bg-tally hover:text-ink"
          >
            Jump to live
          </button>
        )}

        <button
          type="button"
          onClick={fullscreen}
          disabled={!ready}
          className="ml-auto border border-edge px-2.5 py-1.5 font-mono text-[10px] tracking-[0.1em] text-muted uppercase transition-colors hover:text-bone disabled:opacity-40"
        >
          Fullscreen
        </button>
      </div>
    </div>
  );
}
