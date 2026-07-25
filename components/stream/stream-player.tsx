"use client";

import { useEffect, useState } from "react";
import { StreamCanvas } from "@/components/stream/stream-canvas";
import { LiveBadge } from "@/components/ui/bits";
import { compact, timecode } from "@/lib/format";
import {
  embedUrl,
  loadSource,
  parseYouTube,
  saveSource,
  watchUrl,
  type YouTubeSource,
} from "@/lib/youtube";

/**
 * The picture. A viber points the run at a YouTube URL — a live stream, a
 * premiere or a VOD — and that becomes the broadcast. Until one is set, the run
 * falls back to the simulated editor canvas.
 *
 * The source arrives one of three ways: a `?v=` on the URL (so a link can carry
 * a stream), whatever the viber last set for this handle, or the field below the
 * frame. It is read after mount so the page itself stays static.
 */
export function StreamPlayer({
  handle,
  code,
  elapsed: startElapsed,
  viewers: startViewers,
  lowerThird,
}: {
  handle: string;
  code: string;
  elapsed: number;
  viewers: number;
  lowerThird: string;
}) {
  const [source, setSource] = useState<YouTubeSource | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [elapsed, setElapsed] = useState(startElapsed);
  const [viewers, setViewers] = useState(startViewers);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("v");
    const parsed = fromUrl ? parseYouTube(fromUrl) : null;
    if (parsed) {
      setSource(parsed);
      saveSource(handle, parsed);
      return;
    }
    setSource(loadSource(handle));
  }, [handle]);

  useEffect(() => {
    if (!source) return;
    const id = setInterval(() => {
      setElapsed((s) => s + 1);
      setViewers((v) => v + ((v * 3 + 7) % 7) - 3);
    }, 1000);
    return () => clearInterval(id);
  }, [source]);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseYouTube(draft);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setSource(parsed);
    saveSource(handle, parsed);
    setDraft("");
    setEditing(false);
  }

  function clear() {
    setSource(null);
    saveSource(handle, null);
    setDraft("");
    setEditing(false);
  }

  return (
    <div>
      {source ? (
        <div className="border border-edge-soft bg-[#0c0812]">
          <div className="relative aspect-video">
            <iframe
              key={source.id}
              src={embedUrl(source)}
              title={`${code} — live from @${handle}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
            {/* On-air overlay. pointer-events-none so the player stays usable. */}
            <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap items-center gap-2">
              <LiveBadge />
              <span className="bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-muted tabular-nums">
                {timecode(elapsed)}
              </span>
              <span className="bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-muted tabular-nums">
                {compact(viewers)} watching
              </span>
            </div>
          </div>

          {/* Lower-third sits under the frame in video mode, so it never covers
              YouTube's own controls. */}
          <div className="border-t border-amber/30 bg-ink-2 px-4 py-3">
            <p className="font-mono text-[10px] tracking-[0.18em] text-amber uppercase">
              @{handle} is prompting
            </p>
            <p className="mt-1 font-mono text-[12px] leading-snug text-bone sm:text-[13px]">
              {lowerThird}
              <span className="caret" aria-hidden />
            </p>
          </div>
        </div>
      ) : (
        <StreamCanvas
          handle={handle}
          code={code}
          elapsed={startElapsed}
          viewers={startViewers}
          lowerThird={lowerThird}
        />
      )}

      {/* ------------------------------------------------------ source control */}
      <div className="mt-2 border border-edge-soft bg-panel px-3 py-2">
        {source && !editing ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="eyebrow shrink-0">Stream source</p>
            <a
              href={watchUrl(source)}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate font-mono text-[11px] text-teal hover:underline"
            >
              youtube.com/watch?v={source.id}
            </a>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="border border-edge px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-muted uppercase transition-colors hover:border-amber hover:text-amber"
              >
                Change
              </button>
              <button
                type="button"
                onClick={clear}
                className="border border-edge px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-muted uppercase transition-colors hover:border-del hover:text-del"
              >
                Cut feed
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={apply} className="flex flex-wrap items-center gap-2">
            <label htmlFor="stream-src" className="eyebrow shrink-0">
              Stream source
            </label>
            <input
              id="stream-src"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setInvalid(false);
              }}
              placeholder="Paste a YouTube link — live stream, premiere or VOD"
              className={`min-w-0 flex-1 border bg-ink px-2.5 py-1.5 font-mono text-[11px] text-bone placeholder:text-faint focus:outline-none ${
                invalid ? "border-del" : "border-edge focus:border-teal"
              }`}
            />
            <button
              type="submit"
              className="bg-amber px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
            >
              Take feed
            </button>
            {source && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-2 font-mono text-[10px] tracking-[0.1em] text-muted uppercase hover:text-bone"
              >
                Cancel
              </button>
            )}
          </form>
        )}
        <p className={`mt-1.5 font-mono text-[10px] ${invalid ? "text-del" : "text-faint"}`}>
          {invalid
            ? "That isn't a YouTube link. Try a youtube.com/watch, youtu.be or /live/ URL."
            : source
              ? "Playing muted — unmute in the player. Share this page with ?v= to carry the feed."
              : "Any youtube.com/watch, youtu.be, /live/ or /shorts/ link works."}
        </p>
      </div>
    </div>
  );
}
