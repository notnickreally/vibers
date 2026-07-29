"use client";

import { type FormEvent, useCallback, useState } from "react";
import { PROVIDER_LABEL } from "@/lib/source";
import type { Stream } from "@/lib/stream";
import {
  MAX_WATCHED,
  type Watched,
  type WatchlistResult,
  type WatchProvider,
  type WatchReason,
} from "@/lib/watch";

/**
 * The watchlist section of the panel.
 *
 * The wall has always been something you fill by hand or let keyword sourcing
 * guess at. This is the third way, and the one an operator actually asks for:
 * name the channels you care about and they go up the moment they go on air.
 *
 * Two pieces of interface carry the whole idea, so both say it out loud rather
 * than leaving it to be inferred:
 *
 * - **The platform selector only decides a bare word.** A pasted link names its
 *   own platform and that wins, so nobody has to get the toggle right before
 *   pasting. The hint under the field says so.
 * - **"Check now" is not a different mechanism.** It runs exactly the sweep
 *   every visitor's page load already runs. It exists so an operator can watch
 *   the automatic thing happen instead of taking it on faith — which is the
 *   only honest way to demonstrate something that otherwise has no moment.
 *
 * Every action here re-authorizes on the server. This component being on screen
 * proves nothing to `/api/admin/watchlist`, which checks the cookie itself.
 */

/** Why a sweep found nothing, said plainly. Never a shrug. */
const REASON: Record<WatchReason, string> = {
  empty: "Nothing is watched yet. Add a channel and it goes up the next time it is on air.",
  "no-key":
    "YouTube liveness needs YOUTUBE_API_KEY. Finding a channel's newest videos is free; knowing whether one is on right now is not, and a stream is never called live on a guess.",
  "no-twitch-credentials":
    "Twitch liveness needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET. Channels stay watched; nothing goes up until there is a credential to confirm them with.",
  upstream: "A platform didn't answer just now. The wall keeps everything it already has.",
};

/** Deterministic, and UTC — a locale-formatted date would differ across hydration. */
function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface Answer {
  watchlist?: Watched[];
  streams?: Stream[];
  result?: WatchlistResult;
  error?: string;
}

export function Watchlist({
  initial,
  onStreams,
}: {
  initial: Watched[];
  /** A sweep writes to the wall, so the list above this one is stale until told. */
  onStreams: (streams: Stream[]) => void;
}) {
  const [watchlist, setWatchlist] = useState(initial);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<WatchProvider>("youtube");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (label: string, path: string, init: RequestInit): Promise<Answer | null> => {
      setBusy(label);
      setError(null);
      setNote(null);
      try {
        const response = await fetch(`/api/admin/watchlist${path}`, init);
        const data = (await response.json().catch(() => ({}))) as Answer;
        if (!response.ok) {
          // A 401 means the session went away underneath us — expired, or a
          // credential changed. Sending them back to the gate is the only
          // useful thing to do about it.
          if (response.status === 401) {
            window.location.assign("/admin/login");
            return null;
          }
          setError(data.error ?? "That didn't work.");
          return null;
        }
        if (data.watchlist) setWatchlist(data.watchlist);
        return data;
      } catch {
        setError("Couldn't reach the server.");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const add = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;
      const data = await act("add", "", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: trimmed, provider }),
      });
      if (!data) return;
      setInput("");
      setNote(
        data.watchlist?.length
          ? `Watching ${data.watchlist.length} of ${MAX_WATCHED}.`
          : "Added.",
      );
    },
    [act, input, provider],
  );

  const check = useCallback(async () => {
    const data = await act("check", "", { method: "PUT" });
    if (!data) return;
    const found = data.result?.found ?? 0;
    const reasons = data.result?.reasons ?? [];
    if (data.streams) onStreams(data.streams);
    setNote(
      found > 0
        ? `${found} watched ${found === 1 ? "channel is" : "channels are"} on air, and up on the wall.`
        : reasons.length > 0
          ? reasons.map((reason) => REASON[reason]).join(" ")
          : "Nobody watched is on air right now. It looks again on every visit.",
    );
  }, [act, onStreams]);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Watched channels</p>
          <p className="mt-1 max-w-prose text-[15px] text-muted">
            Name a YouTube or Twitch channel and the wall puts its stream up on its own, every
            time it goes on air. Un-watching stops that; it leaves what is already up alone.
          </p>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={check}
          className="border border-edge px-3 py-2 font-mono text-[11px] tracking-[0.12em] text-bone uppercase transition-colors hover:border-teal hover:text-teal disabled:opacity-40"
        >
          {busy === "check" ? "Checking…" : "Check now"}
        </button>
      </div>

      <form onSubmit={add} className="mt-4 flex flex-wrap gap-2">
        <div className="flex border border-edge">
          {(["youtube", "twitch"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={provider === option}
              onClick={() => setProvider(option)}
              className={`px-3 py-2 font-mono text-[11px] tracking-[0.12em] uppercase transition-colors ${
                provider === option ? "bg-panel-2 text-bone" : "text-faint hover:text-muted"
              }`}
            >
              {PROVIDER_LABEL[option]}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="watch-input">
          A username or a profile link
        </label>
        <input
          id="watch-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="@handle, username, or a profile link"
          spellCheck={false}
          autoComplete="off"
          className="min-w-[16rem] flex-1 border border-edge bg-panel px-3 py-2 font-mono text-[13px] text-bone placeholder:text-faint focus:border-teal focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy !== null || input.trim() === ""}
          className="border border-edge px-4 py-2 font-mono text-[11px] tracking-[0.12em] text-bone uppercase transition-colors hover:border-teal hover:text-teal disabled:opacity-40"
        >
          {busy === "add" ? "Adding…" : "Watch"}
        </button>
      </form>

      <p className="mt-2 font-mono text-[11px] text-faint">
        A link says which platform it is and overrides the choice above. A bare username needs
        it. {watchlist.length} of {MAX_WATCHED} watched.
      </p>

      <div aria-live="polite" className="mt-3 min-h-[1.75rem]">
        {error && <p className="font-mono text-[12px] text-del">{error}</p>}
        {note && !error && <p className="font-mono text-[12px] text-teal">{note}</p>}
      </div>

      {watchlist.length === 0 ? (
        <p className="mt-1 border border-edge-soft bg-panel p-6 font-mono text-[13px] text-faint">
          Nobody is watched.
        </p>
      ) : (
        <ul className="mt-1 space-y-px border border-edge-soft bg-edge-soft">
          {watchlist.map((entry) => (
            <li
              key={entry.key}
              className="flex items-center gap-4 bg-ink p-3 transition-colors hover:bg-panel"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-sm text-bone transition-colors hover:text-amber"
                  >
                    {entry.name}
                  </a>
                  <span className="border border-edge px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-faint">
                    {PROVIDER_LABEL[entry.provider].toUpperCase()}
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-faint">
                  {entry.input} · added {day(entry.addedAt)}
                  {entry.addedBy ? ` by ${entry.addedBy}` : ""} ·{" "}
                  {entry.lastLiveAt !== undefined
                    ? `last on air ${day(entry.lastLiveAt)}`
                    : "not seen on air yet"}
                </p>
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  const data = await act(
                    entry.key,
                    `?key=${encodeURIComponent(entry.key)}`,
                    { method: "DELETE" },
                  );
                  if (data) setNote(`No longer watching ${entry.name}.`);
                }}
                aria-label={`Stop watching ${entry.name}`}
                className="shrink-0 border border-edge px-2.5 py-1.5 font-mono text-[11px] text-muted transition-colors hover:border-del hover:text-del disabled:opacity-40"
              >
                {busy === entry.key ? "…" : "✕"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
