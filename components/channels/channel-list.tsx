"use client";

import { type FormEvent, useCallback, useState } from "react";
import { PROVIDER_LABEL } from "@/lib/source";
import {
  MAX_WATCHED,
  type Watched,
  type WatchlistResult,
  type WatchProvider,
  type WatchReason,
} from "@/lib/watch";

/**
 * The watched channels, as a page anybody can use.
 *
 * The wall has always been something you fill by hand or let keyword sourcing
 * guess at. This is the third way, and the one people actually ask for: name the
 * channels you care about and they go up the moment they go on air.
 *
 * It used to be a section of `/admin`, gated in both directions. Adding is open
 * now, for the same reason putting a stream up is open — the wall is
 * everybody's — and the one asymmetry is spelled out on screen rather than left
 * to be discovered:
 *
 * - **Anyone can add.** A pasted link names its own platform and that wins, so
 *   nobody has to get the toggle right before pasting; the selector only decides
 *   a bare word. The hint under the field says so.
 * - **Only an operator can un-watch.** Adding a name is additive and costs
 *   everyone nothing; taking one off happens to everybody at once, so it stays
 *   with whoever holds the panel. Non-admins are told that, instead of being
 *   shown a button that 401s.
 * - **"Check now" is not a different mechanism.** It runs exactly the sweep
 *   every visitor's page load already runs. It exists so the automatic thing can
 *   be watched happening instead of taken on faith — the only honest way to
 *   demonstrate something that otherwise has no moment.
 * - **Adding presses it for you.** A name typed in is nearly always a name
 *   somebody wants an answer about now, so a successful add runs the check
 *   immediately rather than leaving the channel unasked-about until the wall's
 *   next sourcing run.
 *
 * Every action here re-authorizes on the server. This component being on screen
 * proves nothing to `/api/watchlist`, which checks the cookie for `DELETE`
 * itself — `isAdmin` below decides what is drawn, never what is allowed.
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
  result?: WatchlistResult;
  error?: string;
}

export function ChannelList({
  initial,
  isAdmin,
}: {
  /** Server-rendered, so the list is on screen before any JavaScript runs. */
  initial: Watched[];
  /** Whether to draw the un-watch buttons. The route decides whether they work. */
  isAdmin: boolean;
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
        const response = await fetch(`/api/watchlist${path}`, init);
        const data = (await response.json().catch(() => ({}))) as Answer;
        if (!response.ok) {
          // A 401 only ever comes back from `DELETE`, and only for a session
          // that went away underneath us — expired, or a credential changed.
          // Sending them back to the gate is the only useful thing to do.
          if (response.status === 401 && init.method === "DELETE") {
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

  /** What the sweep found, in the one sentence the page has room for. */
  const sweepNote = useCallback((result?: WatchlistResult): string => {
    const found = result?.found ?? 0;
    const reasons = result?.reasons ?? [];
    if (found > 0) {
      return `${found} watched ${found === 1 ? "channel is" : "channels are"} on air, and up on the wall.`;
    }
    if (reasons.length > 0) return reasons.map((reason) => REASON[reason]).join(" ");
    return "Nobody watched is on air right now. It looks again on every visit.";
  }, []);

  const check = useCallback(
    async (label: string, prefix = "") => {
      const data = await act(label, "", { method: "PUT" });
      if (!data) return;
      setNote(`${prefix}${sweepNote(data.result)}`);
    },
    [act, sweepNote],
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
      const added = data.watchlist?.length
        ? `Watching ${data.watchlist.length} of ${MAX_WATCHED}. `
        : "Added. ";
      setNote(added);
      // The whole reason to watch a channel is the moment it goes on air, and a
      // name typed in now is most likely a name somebody is watching now. So the
      // add itself asks — the sweep, run early rather than waited for, which also
      // puts the channel up if it happens to be live.
      await check("add", added);
    },
    [act, check, input, provider],
  );

  return (
    <div className="space-y-8">
      <section className="border border-edge-soft bg-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Watch a channel</p>
            <p className="mt-1 max-w-prose text-[15px] text-muted">
              Name a YouTube or Twitch channel and the wall puts its stream up on its own, every
              time it goes on air. Anyone can add one — it is the same wall.
            </p>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => check("check")}
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
            className="min-w-[16rem] flex-1 border border-edge bg-ink px-3 py-2 font-mono text-[13px] text-bone placeholder:text-faint focus:border-teal focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy !== null || input.trim() === ""}
            className="bg-amber px-5 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone disabled:cursor-not-allowed disabled:bg-edge disabled:text-faint"
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
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-edge-soft pb-3">
          <p className="eyebrow">Watched channels</p>
          {/* Said out loud, because the missing button is the whole rule. Nobody
              should have to press something and read a 401 to find this out. */}
          <p className="font-mono text-[11px] text-faint">
            {isAdmin
              ? "Signed in — un-watching stops the wall adding a channel; it leaves what is already up alone."
              : "Anyone can add a channel. Taking one off is an operator's, because it stops for everybody."}
          </p>
        </div>

        {watchlist.length === 0 ? (
          <p className="mt-4 border border-edge-soft bg-panel p-6 font-mono text-[13px] text-faint">
            Nobody is watched.
          </p>
        ) : (
          <ul className="mt-4 space-y-px border border-edge-soft bg-edge-soft">
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
                {isAdmin && (
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
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
