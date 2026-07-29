"use client";

import { useEffect, useState } from "react";
import { LiveBadge } from "@/components/ui/bits";
import { embedFor, posterFor, type SourceOf, sourceNoun } from "@/lib/source";

/**
 * The Twitch picture — Twitch's own player, in vibers.tv's frame.
 *
 * Deliberately **not** `CleanPlayer`. That component is YouTube's IFrame Player
 * API end to end: it loads Google's script, drives a `YT.Player` instance, and
 * builds a live-edge estimate on top of `getCurrentTime` because YouTube's
 * `getDuration` is not the live edge. None of that has a Twitch counterpart —
 * Twitch's embed API is a different script, a different object and a different
 * set of lies about the clock — so bolting a second driver into that file would
 * mean two players sharing nothing but a name, and every future change to the
 * YouTube live-edge maths having to be reasoned about twice.
 *
 * So this is the honest small version: Twitch's player, with **Twitch's own
 * controls left on**. That is a real difference from the YouTube side and it is
 * the right trade rather than a shortfall — the controls are how you scrub a
 * VOD, and hiding them without an API to replace them would leave a picture
 * nobody can drive. It also keeps Twitch's branding on Twitch's player, which
 * is the attribution the YouTube player gives up (see the note in
 * `clean-player.tsx` about what that costs).
 *
 * The frame cannot be built during a server render. Twitch answers
 * `frame-ancestors <parent>` and refuses without one, `parent` must be this
 * page's hostname exactly, and a hostname only exists in a browser — so the
 * first paint is the poster at the picture's exact size, never a layout shift.
 */
export function TwitchPlayer({
  source,
  title,
  channel,
  isLive,
}: {
  source: SourceOf<"twitch">;
  title?: string;
  channel?: string;
  isLive?: boolean;
}) {
  const [host, setHost] = useState<string | null>(null);

  useEffect(() => {
    setHost(window.location.hostname);
  }, []);

  // Unmuted, unlike the wall's tiles: this is the one stream someone opened, so
  // autoplay may be refused and that is the browser's call to make. Twitch
  // honours `muted=false` where it can and pauses where it can't, which is a
  // player waiting for a click rather than a picture playing silently at
  // someone who came here to listen.
  const src = host
    ? embedFor(source, { parent: host, autoplay: true, muted: false, controls: true })
    : null;

  return (
    <div className="border border-edge-soft bg-ink-2">
      <div className="flex items-center gap-3 border-b border-edge-soft px-3 py-2">
        {isLive === true && <LiveBadge />}
        <p className="min-w-0 flex-1 truncate text-[13px] text-bone">{title ?? "Loading…"}</p>
        {channel && <p className="shrink-0 font-mono text-[11px] text-faint">{channel}</p>}
      </div>

      <div className="relative aspect-video bg-black">
        {src ? (
          <iframe
            src={src}
            title={title ?? `Twitch ${sourceNoun(source)}`}
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <>
            {/* The poster, at the picture's exact size. Twitch keeps a live
                channel's current frame at a predictable URL, so this is the
                stream itself a moment ago rather than a placeholder. */}
            <img
              src={posterFor(source)}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover opacity-70"
            />
            <span className="absolute bottom-3 left-3 border border-edge bg-ink/85 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.16em] text-bone uppercase">
              Tuning in…
            </span>
          </>
        )}
      </div>
    </div>
  );
}
