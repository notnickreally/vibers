"use client";

import type { DiscoverLeg, DiscoverResult, Reason, TwitchReason } from "@/lib/discover";
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
 * several quite different causes here — the deployment has it switched off, there
 * is no API key, the day's search quota is spent, a platform was unreachable, a
 * category is misspelled, or genuinely nothing matched — and they are not
 * interchangeable. Collapsing them into a shrug is the same failure as a dark
 * tally lamp that never says why.
 *
 * **Three findings land here, kept apart on purpose**, because they answer three
 * different questions and fail in three different ways:
 *
 * - **YouTube by keyword** asks *what is live that matches "live coding"*. It is
 *   the one that runs out of quota, for the whole day, for every environment at
 *   once.
 * - **Twitch by category** asks *who is live in Software and Game Development*.
 *   It cannot run out of quota — Helix's limit refills every minute — but it can
 *   be pointed at a category name Twitch has never heard of.
 * - **The watchlist** asks *are the channels an admin named on air*, on both
 *   platforms, and it never runs out of anything because reading a channel's
 *   newest videos costs nothing.
 *
 * Merging any two of them would make one platform's bad day look like the
 * other's empty result: a spent YouTube allowance alongside six live Twitch
 * streams is a good run, and one collapsed line would report it as a broken one.
 */

const REASON: Record<Reason, string> = {
  off: "YouTube sourcing is switched off here. It runs where YOUTUBE_DISCOVER_ENABLED is set — kept per-environment because every deployment shares one daily search allowance.",
  "no-key":
    "YouTube sourcing needs YOUTUBE_API_KEY. Searching YouTube has no key-free path, so rather than guess at what might be live, it finds nothing.",
  quota:
    "Today's YouTube search allowance is spent — it refills at midnight Pacific. Streams already on the wall keep refreshing; that runs on a different allowance.",
  upstream: "Couldn't reach YouTube's search just now. The wall keeps everything it already has.",
};

/**
 * Twitch's own reasons — a different list, because Twitch fails differently.
 *
 * There is no "allowance spent" line and there cannot be one: Helix charges
 * against a bucket that refills every minute rather than a daily quota, so the
 * honest failure is "not just now", never "come back tomorrow".
 */
const TWITCH_REASON: Record<TwitchReason, string> = {
  off: "Twitch sourcing is switched off here. It runs where TWITCH_DISCOVER_ENABLED is set.",
  "no-credentials":
    "Twitch sourcing needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET. Twitch has no key-free way to ask who is on air, so rather than guess, it finds nothing.",
  "no-category":
    "Twitch doesn't recognise any of the categories this deployment is set to watch. Check TWITCH_DISCOVER_CATEGORIES against the category names Twitch itself uses.",
  upstream: "Couldn't reach Twitch just now. The wall keeps everything it already has.",
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

/** `1 live stream` / `4 live streams` — the count and its noun, agreeing. */
function streams(count: number): string {
  return `${count} live ${count === 1 ? "stream" : "streams"}`;
}

/**
 * One platform's line.
 *
 * A leg that is switched off says nothing at all rather than saying it is off:
 * a deployment that only wants YouTube should not have a Twitch sentence under
 * every run explaining a feature nobody asked for. Every *other* reason is worth
 * a line, because every other reason is something that could be fixed.
 */
function legLine<R extends string>(
  found: DiscoverLeg<R>,
  copy: Record<R, string>,
  confirmed: string,
): string {
  if (found.reason === "off") return "";
  if (found.reason) return copy[found.reason];
  if (found.found > 0) return `${streams(found.found)} found and put up. ${confirmed}`;
  return "Nothing matching is on air right now. It looks again on your next visit.";
}

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

/**
 * The chips under the lines: what each leg was pointed at.
 *
 * Labelled per platform because the two are not the same kind of thing — YouTube
 * is searching for words in a title, Twitch is naming a section of its own
 * directory — and a row of undifferentiated chips would imply the wall looks for
 * "live coding" on Twitch, which is exactly what it cannot do.
 */
function Asked({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[10px] tracking-[0.12em] text-faint uppercase">{label}</span>
      {items.map((item) => (
        <span
          key={item}
          className="border border-edge bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-faint"
        >
          {item}
        </span>
      ))}
    </div>
  );
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
  const watched = watchLine(watchlist);
  const youtube = result
    ? legLine(
        result.youtube,
        REASON,
        "Every one was confirmed on air, not just listed as live.",
      )
    : "";
  const twitch = result
    ? legLine(result.twitch, TWITCH_REASON, "Twitch lists only channels that are on air.")
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

      {state === "sourcing" ? (
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted">
          Searching YouTube and Twitch for streams that are on air…
        </p>
      ) : (
        <>
          {youtube !== "" && (
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted">
              <span className="text-faint">YouTube — </span>
              {youtube}
            </p>
          )}
          {twitch !== "" && (
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted">
              <span className="text-faint">Twitch — </span>
              {twitch}
            </p>
          )}
          {watched !== "" && (
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-faint">{watched}</p>
          )}
        </>
      )}

      {state === "done" && (
        <>
          <Asked label="Searched" items={result?.youtube.asked ?? []} />
          <Asked label="Categories" items={result?.twitch.asked ?? []} />
        </>
      )}
    </div>
  );
}
