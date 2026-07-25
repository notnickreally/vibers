"use client";

import { useState } from "react";
import { addStream, lookup, type Metadata, type Stream } from "@/lib/stream";
import { parseYouTube } from "@/lib/youtube";

/**
 * Paste a URL, get the real thing. The title, channel and thumbnail are pulled
 * from YouTube — nothing is typed in by hand, so nothing can be misattributed.
 */
export function AddStream({ onAdded }: { onAdded: (streams: Stream[]) => void }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "looking" | "error">("idle");
  const [error, setError] = useState("");
  const [found, setFound] = useState<Metadata | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseYouTube(url);
    if (!parsed) {
      setState("error");
      setError("That isn't a YouTube link. Try youtube.com/watch, youtu.be or /live/.");
      return;
    }

    setState("looking");
    setError("");
    setFound(null);
    try {
      const meta = await lookup(parsed.id);
      onAdded(addStream(meta));
      setFound(meta);
      setUrl("");
      setState("idle");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Lookup failed.");
    }
  }

  return (
    <div className="border border-edge-soft bg-panel p-4 sm:p-5">
      <form onSubmit={submit}>
        <label htmlFor="add-url" className="eyebrow block">
          Put a stream on the wall
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            id="add-url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (state === "error") setState("idle");
            }}
            placeholder="https://www.youtube.com/live/…"
            className={`min-w-0 flex-1 border bg-ink px-3 py-2.5 font-mono text-[13px] text-bone placeholder:text-faint focus:outline-none ${
              state === "error" ? "border-del" : "border-edge focus:border-amber"
            }`}
          />
          <button
            type="submit"
            disabled={state === "looking" || !url.trim()}
            className="bg-amber px-5 py-2.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone disabled:cursor-not-allowed disabled:bg-edge disabled:text-faint"
          >
            {state === "looking" ? "Looking up…" : "Add"}
          </button>
        </div>
      </form>

      <p
        className={`mt-2 font-mono text-[10px] leading-relaxed ${
          state === "error" ? "text-del" : "text-faint"
        }`}
      >
        {state === "error"
          ? error
          : "The title and channel come straight from YouTube. Live streams, premieres and recorded videos all work."}
      </p>

      {found && (
        <div className="mt-4 flex gap-3 border border-add/40 bg-add/6 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={found.thumbnail} alt="" className="h-14 w-24 shrink-0 object-cover" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.14em] text-add uppercase">
              Added to the wall
            </p>
            <p className="mt-1 truncate text-sm text-bone">{found.title}</p>
            <p className="font-mono text-[11px] text-faint">{found.channel}</p>
          </div>
        </div>
      )}
    </div>
  );
}
