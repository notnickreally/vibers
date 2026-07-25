"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
 * The picture. A viber points their own run at a YouTube URL — a live stream, a
 * premiere or a VOD — and that becomes the broadcast. Until one is set, the run
 * falls back to the simulated editor canvas.
 *
 * Three rules this component exists to enforce:
 *
 * 1. **Opt-in.** Only the broadcaster can attach a feed to their own run. A
 *    viewer gets no source control, and a crafted `?v=` link is ignored on
 *    someone else's page — otherwise anyone could stage a stranger's stream as
 *    a vibers.tv run.
 * 2. **The player is never modified.** Nothing is drawn over the iframe; the
 *    on-air strip sits above it and the lower-third below. YouTube's controls,
 *    branding and ads stay entirely untouched.
 * 3. **Attribution travels with the video** — every viewer sees where the
 *    picture comes from and can report it.
 */
export function StreamPlayer({
  handle,
  code,
  elapsed: startElapsed,
  viewers: startViewers,
  lowerThird,
  owned,
}: {
  handle: string;
  code: string;
  elapsed: number;
  viewers: number;
  lowerThird: string;
  /** True when the signed-in viber is the one broadcasting this run. */
  owned: boolean;
}) {
  const [source, setSource] = useState<YouTubeSource | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [elapsed, setElapsed] = useState(startElapsed);
  const [viewers, setViewers] = useState(startViewers);

  useEffect(() => {
    // A feed can only ever be set by its broadcaster, so a `?v=` link is only
    // honoured on your own run.
    if (!owned) return;
    const fromUrl = new URLSearchParams(window.location.search).get("v");
    const parsed = fromUrl ? parseYouTube(fromUrl) : null;
    if (parsed) {
      setSource(parsed);
      saveSource(handle, parsed);
      return;
    }
    setSource(loadSource(handle));
  }, [handle, owned]);

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

  if (!source) {
    return (
      <div>
        <StreamCanvas
          handle={handle}
          code={code}
          elapsed={startElapsed}
          viewers={startViewers}
          lowerThird={lowerThird}
        />
        {owned && (
          <SourceForm
            draft={draft}
            invalid={invalid}
            onChange={(v) => {
              setDraft(v);
              setInvalid(false);
            }}
            onSubmit={apply}
          />
        )}
      </div>
    );
  }

  const reportHref = `/report?run=${encodeURIComponent(code)}&handle=${encodeURIComponent(
    handle,
  )}&v=${encodeURIComponent(source.id)}`;

  return (
    <div>
      {/* On-air strip — above the frame, so nothing is drawn over the player. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-b-0 border-edge-soft bg-ink-2 px-3 py-2">
        <LiveBadge />
        <span className="font-mono text-[11px] text-muted tabular-nums">{timecode(elapsed)}</span>
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {compact(viewers)} watching
        </span>
        <span className="ml-auto font-mono text-[10px] tracking-[0.14em] text-faint">{code}</span>
      </div>

      <div className="relative aspect-video border-x border-edge-soft bg-[#0c0812]">
        <iframe
          key={source.id}
          src={embedUrl(source)}
          title={`${code} — live from @${handle}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      </div>

      {/* Lower-third, beneath the frame. */}
      <div className="border border-t-amber/30 border-edge-soft bg-ink-2 px-4 py-3">
        <p className="font-mono text-[10px] tracking-[0.18em] text-amber uppercase">
          @{handle} is prompting
        </p>
        <p className="mt-1 font-mono text-[12px] leading-snug text-bone sm:text-[13px]">
          {lowerThird}
          <span className="caret" aria-hidden />
        </p>
      </div>

      {/* Attribution — shown to every viewer, not just the broadcaster. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border border-edge-soft bg-panel px-3 py-2">
        <p className="eyebrow shrink-0">Picture</p>
        <p className="min-w-0 flex-1 font-mono text-[11px] text-faint">
          Hosted on YouTube by its creator. vibers.tv plays the original video and
          does not modify or re-host it.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={watchUrl(source)}
            target="_blank"
            rel="noreferrer"
            className="border border-edge px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-teal uppercase transition-colors hover:border-teal"
          >
            Watch on YouTube ↗
          </a>
          <Link
            href={reportHref}
            className="border border-edge px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-muted uppercase transition-colors hover:border-del hover:text-del"
          >
            Report feed
          </Link>
        </div>
      </div>

      {/* Broadcaster-only controls. */}
      {owned &&
        (editing ? (
          <SourceForm
            draft={draft}
            invalid={invalid}
            onCancel={() => setEditing(false)}
            onChange={(v) => {
              setDraft(v);
              setInvalid(false);
            }}
            onSubmit={apply}
          />
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border border-edge-soft bg-panel px-3 py-2">
            <p className="eyebrow shrink-0">Your feed</p>
            <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
              youtube.com/watch?v={source.id}
            </p>
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
        ))}
    </div>
  );
}

function SourceForm({
  draft,
  invalid,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: string;
  invalid: boolean;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel?: () => void;
}) {
  return (
    <div className="mt-2 border border-edge-soft bg-panel px-3 py-2">
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <label htmlFor="stream-src" className="eyebrow shrink-0">
          Your feed
        </label>
        <input
          id="stream-src"
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste the YouTube link you're broadcasting to"
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
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-2 font-mono text-[10px] tracking-[0.1em] text-muted uppercase hover:text-bone"
          >
            Cancel
          </button>
        )}
      </form>
      <p className={`mt-1.5 font-mono text-[10px] ${invalid ? "text-del" : "text-faint"}`}>
        {invalid
          ? "That isn't a YouTube link. Try a youtube.com/watch, youtu.be or /live/ URL."
          : "Only your own stream. Attaching someone else's broadcast to a run is not allowed."}
      </p>
    </div>
  );
}
