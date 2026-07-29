"use client";

import { useState } from "react";
import { parseSource, PROVIDER_LABEL, sourceKey } from "@/lib/source";
import { addStream, type Metadata, type Stream } from "@/lib/stream";

/**
 * Paste a URL, get the real thing. The title, channel and thumbnail are pulled
 * from the platform it came from — nothing is typed in by hand, so nothing can
 * be misattributed.
 *
 * One call rather than two now: the wall's route does the lookup itself, on
 * the server, because what lands here goes on everyone's wall.
 *
 * The box takes **YouTube or Twitch**, and it does not ask which. `parseSource`
 * works it out from the link, so there is no picker to get wrong — one field,
 * paste anything, and the only thing the interface has to say about platforms is
 * which one it recognised.
 */
export function AddStream({ onAdded }: { onAdded: (streams: Stream[]) => void }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "looking" | "error">("idle");
  const [error, setError] = useState("");
  const [found, setFound] = useState<Metadata | null>(null);
  const [platform, setPlatform] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseSource(url);
    if (!parsed) {
      setState("error");
      setError(
        "That isn't a YouTube or Twitch link. Try youtube.com/watch, youtu.be, /live/, " +
          "twitch.tv/<channel>, twitch.tv/videos/… or a clip.",
      );
      return;
    }

    setState("looking");
    setError("");
    setFound(null);
    setPlatform(PROVIDER_LABEL[parsed.provider]);
    try {
      const { streams, added } = await addStream(sourceKey(parsed));
      onAdded(streams);
      setFound(added);
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
            placeholder="https://www.youtube.com/live/… or https://twitch.tv/…"
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
          : "YouTube or Twitch — the title and channel come straight from whichever it is. Live streams, premieres, recorded videos, Twitch channels, VODs and clips all work."}
      </p>

      {found && (
        <div className="mt-4 flex gap-3 border border-add/40 bg-add/6 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={found.thumbnail} alt="" className="h-14 w-24 shrink-0 object-cover" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.14em] text-add uppercase">
              Added to the wall{platform && ` · ${platform}`}
            </p>
            <p className="mt-1 truncate text-sm text-bone">{found.title}</p>
            <p className="font-mono text-[11px] text-faint">{found.channel}</p>
          </div>
        </div>
      )}
    </div>
  );
}
