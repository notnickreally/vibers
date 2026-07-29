"use client";

import type { DiscoverResult } from "@/lib/discover";
import type { WatchlistResult, WatchReason } from "@/lib/watch";

/**
 * What auto-sourcing did, said plainly.
 *
 * Presentational on purpose: the wall owns the run, because discovery has to be
 * sequenced *after* the liveness refresh that lands on the same mount — two
 * writers reading the store and writing it back independently is a lost update,
 * and the one that resolves second wins.
 *
 * The panel's whole job is to never leave an unexplained gap. An empty wall has
 * five quite different causes here — the deployment has it switched off, there
 * is no API key, the day's search quota is spent, YouTube was unreachable, or
 * genuinely nothing matched — and they are not interchangeable. Collapsing them
 * into a shrug is the same failure as a dark tally lamp that never says why.
 *
 * Two findings land here, kept apart on purpose. Keyword search asks *what is
 * live that matches "live coding"*, and it is the one that runs out of quota.
 * The watchlist asks *are the channels an admin named on air*, and it never
 * does, because reading a channel's newest videos costs nothing. Merging them
 * into one line would make a spent search allowance look like nobody streaming.
 */

const REASON: Record<NonNullable<DiscoverResult["reason"]>, string> = {
  off: "Auto-sourcing is switched off here. It runs where YOUTUBE_DISCOVER_ENABLED is set — kept per-environment because every deployment shares one daily search allowance.",
  "no-key":
    "Auto-sourcing needs YOUTUBE_API_KEY. Searching YouTube has no key-free path, so rather than guess at what might be live, it finds nothing.",
  quota:
    "Today's YouTube search allowance is spent — it refills at midnight Pacific. Streams already on the wall keep refreshing; that runs on a different allowance.",
  upstream: "Couldn't reach YouTube's search just now. The wall keeps everything it already has.",
};

/**
 * The watchlist's own reasons. `empty` has no line here — nobody being watched
 * is a setting, not a failure, and it is not a visitor's business.
 */
const WATCH_REASON: Record<Exclude<WatchReason, "empty">, string> = {
  "no-key": "Watched YouTube channels need YOUTUBE_API_KEY before one can be called live.",
  "no-twitch-credentials":
    "Watched Twitch channels need TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET before one can be called live.",
  upstream: "A platform didn't answer when the watched channels were checked.",
};

/** What the watchlist leg of the run found, or why it found nothing. */
function watchLine(watchlist: WatchlistResult | null): string {
  if (!watchlist || watchlist.watched === 0) return "";
  if (watchlist.found > 0) {
    return `${watchlist.found} watched ${
      watchlist.found === 1 ? "channel is" : "channels are"
    } on air, and up.`;
  }
  const said = watchlist.reasons
    .filter((reason): reason is Exclude<WatchReason, "empty"> => reason !== "empty")
    .map((reason) => WATCH_REASON[reason]);
  return said.length > 0
    ? said.join(" ")
    : `None of the ${watchlist.watched} watched channels is on air.`;
}

export function AutoSource({
  state,
  result,
  watchlist,
  count,
  onClear,
}: {
  state: "idle" | "sourcing" | "done";
  result: DiscoverResult | null;
  watchlist: WatchlistResult | null;
  count: number;
  onClear: () => void;
}) {
  const reason = result?.reason;
  const keywords = result?.keywords ?? [];
  const watched = watchLine(watchlist);

  const line =
    state === "sourcing"
      ? "Searching YouTube for streams that are on air…"
      : reason
        ? REASON[reason]
        : result
          ? result.streams.length > 0
            ? `${result.streams.length} live ${
                result.streams.length === 1 ? "stream" : "streams"
              } found and put up. Every one was confirmed on air, not just listed as live.`
            : "Nothing matching is on air right now. It looks again on your next visit."
          : "";

  if (state === "idle") return null;

  return (
    <div className="mt-4 border border-edge-soft bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="eyebrow">Sourced for you</p>
        {count > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto font-mono text-[10px] tracking-[0.12em] text-faint uppercase transition-colors hover:text-del"
          >
            Clear {count} sourced
          </button>
        )}
      </div>

      <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted">{line}</p>

      {state === "done" && watched !== "" && (
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-faint">{watched}</p>
      )}

      {keywords.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {keywords.map((keyword) => (
            <span
              key={keyword}
              className="border border-edge bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-faint"
            >
              {keyword}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
