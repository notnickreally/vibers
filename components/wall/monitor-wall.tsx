"use client";

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AddStream } from "@/components/wall/add-stream";
import { AutoSource } from "@/components/wall/auto-source";
import { EmptyState, WallSkeleton } from "@/components/states";
import { LiveBadge } from "@/components/ui/bits";
import type { DiscoverResult } from "@/lib/discover";
import { compact } from "@/lib/format";
import { YT_CHROME_MS } from "@/lib/player-time";
import { embedFor, parseKey, watchHref } from "@/lib/source";
import { safeHttpUrl } from "@/lib/youtube";
import {
  cardState,
  clearSourced,
  DEFAULT_MODE,
  initialShelf,
  listStreams,
  type Mode,
  MODES,
  partition,
  refreshLiveness,
  removeStream,
  type Shelf,
  shelf,
  stateLabel,
  sourceStreams,
  type Stream,
} from "@/lib/stream";

/**
 * The wall: every stream you've put on the network, as a bank of monitors.
 *
 * Two modes, because they trade off against each other. **Monitors** is the
 * default: live muted players, the view worth having open on a second screen,
 * at one embed per tile. **Posters** swaps them for thumbnails — cheap, quiet,
 * scrolls forever — for when the wall is long or the connection is not.
 *
 * And two tabs, because a wall is about what is on air. **Live** is the wall
 * proper; **Ended** is where a broadcast goes when it finishes, so a stream
 * that ended three weeks ago stops taking up a monitor. Liveness is re-asked
 * on load — `isLive` is stamped when a stream is added, and believing that
 * forever is how a finished stream stays on the Live tab for good.
 *
 * The wall is one wall, shared: everything below reads and writes the streams
 * table in Neon through `/api/streams`, so what is on screen is what everyone
 * else is looking at. That makes the store fallible in a way a localStorage
 * one never was, so there is a failure path — and it is a message, never a
 * fallback. An empty grid where a full wall should be is a lie that looks
 * exactly like the truth.
 */

type Size = 2 | 3 | 4;

const SHELVES: Shelf[] = ["live", "ended"];
const SHELF_LABEL: Record<Shelf, string> = { live: "Live", ended: "Ended" };

export function MonitorWall() {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>(DEFAULT_MODE);
  const [size, setSize] = useState<Size>(3);
  const [tab, setTab] = useState<Shelf>("live");
  const [sourcing, setSourcing] = useState<"idle" | "sourcing" | "done">("idle");
  const [sourced, setSourced] = useState<DiscoverResult | null>(null);
  const [error, setError] = useState("");
  // Once someone has picked a tab, the refresh landing must not pull it back.
  const touchedRef = useRef(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;

    function land(next: Stream[]) {
      if (cancelled) return;
      setStreams(next);
      if (!touchedRef.current) setTab(initialShelf(next));
    }

    // Three sequential calls, and the order is the same one the browser store
    // needed: what is on the wall, then what is still on air, then what else
    // we can find. Sourcing runs *after* the refresh rather than beside it
    // because both write the same rows, and a refresh landing on top of a
    // sourcing run would judge streams it hasn't seen.
    listStreams()
      .then((stored) => {
        land(stored);
        if (!cancelled) setLoading(false);
        return refreshLiveness();
      })
      .then((next) => {
        if (cancelled) return;
        land(next);
        setSourcing("sourcing");
        return sourceStreams();
      })
      .then((found) => {
        if (cancelled || !found) return;
        land(found.streams);
        setSourced(found.result);
        setSourcing("done");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Said, never swallowed. The wall is remote now, and a wall that can't
        // be reached has to look different from a wall with nothing on it.
        setError(err instanceof Error ? err.message : "The wall isn't answering.");
        setSourcing("idle");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { live, ended } = useMemo(() => partition(streams), [streams]);
  const counts: Record<Shelf, number> = { live: live.length, ended: ended.length };
  const sourcedCount = useMemo(
    () => streams.filter((s) => s?.sourcedAt !== undefined).length,
    [streams],
  );

  const cols = {
    2: "sm:grid-cols-1 lg:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  }[size];

  const selectTab = useCallback((next: Shelf) => {
    touchedRef.current = true;
    setTab(next);
  }, []);

  // Every write goes through here so a failed one reports itself rather than
  // leaving the grid showing a change that never reached the database.
  const write = useCallback(async (action: () => Promise<Stream[]>) => {
    try {
      setStreams(await action());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The wall isn't answering.");
    }
  }, []);

  // Arrow keys move between tabs, Home/End jump to the ends — the half of the
  // tabs pattern that a plain row of buttons doesn't give you for free.
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = SHELVES.indexOf(tab);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % SHELVES.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + SHELVES.length) % SHELVES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = SHELVES.length - 1;
    else return;
    event.preventDefault();
    selectTab(SHELVES[next]);
    tabRefs.current[next]?.focus();
  }

  const tabBase =
    "border-b-2 px-1 pb-2 font-mono text-[11px] tracking-[0.12em] uppercase transition-colors";

  function tabClass(name: Shelf) {
    return tab === name
      ? `${tabBase} border-amber text-amber`
      : `${tabBase} border-transparent text-faint hover:text-bone`;
  }

  return (
    <div>
      <AddStream onAdded={setStreams} />
      <AutoSource
        state={sourcing}
        result={sourced}
        count={sourcedCount}
        onClear={() => write(clearSourced)}
      />

      {error && (
        <p
          role="alert"
          className="mt-4 border border-del/50 bg-del/8 p-4 font-mono text-[11px] leading-relaxed text-del sm:p-5"
        >
          {error}
        </p>
      )}

      {/* The invitation to paste something is only honest while nothing is on
          its way. Sourcing lands a moment after mount, so showing it first
          would flash "Nothing on the wall" at a wall about to fill itself. */}
      {error && streams.length === 0 ? null : loading ||
        (streams.length === 0 && sourcing === "sourcing") ? (
        <div className="mt-10">
          <WallSkeleton count={6} />
        </div>
      ) : streams.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            slate="Nothing on the wall"
            title="Put a stream up"
            body="Paste the URL of a YouTube live stream above. It gets its real title and channel from YouTube, and it goes up for everyone — this is one wall, and it stays as it is until someone takes it down."
          />
        </div>
      ) : (
        <>
          <div className="mt-10 flex flex-wrap items-center gap-5 border-b border-edge-soft">
            <div role="tablist" aria-label="Wall" className="flex items-center gap-5">
              {SHELVES.map((name, i) => (
                <button
                  key={name}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`wall-tab-${name}`}
                  aria-selected={tab === name}
                  aria-controls={`wall-panel-${name}`}
                  // Roving tab stop: the tablist is one stop, arrows move inside it.
                  tabIndex={tab === name ? 0 : -1}
                  onClick={() => selectTab(name)}
                  onKeyDown={onTabKeyDown}
                  className={tabClass(name)}
                >
                  <span className="flex items-center gap-2">
                    {SHELF_LABEL[name]}
                    <span className="tabular-nums opacity-70">{counts[name]}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">
                View
              </span>
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`border px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors ${
                    mode === m
                      ? "border-amber bg-amber/12 text-amber"
                      : "border-edge-soft text-muted hover:text-bone"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">
                Grid
              </span>
              {([2, 3, 4] as Size[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  className={`w-7 border py-1 font-mono text-[10px] transition-colors ${
                    size === s
                      ? "border-amber bg-amber/12 text-amber"
                      : "border-edge-soft text-muted hover:text-bone"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            {mode === "monitors" && tab === "live" && live.length > 0 && (
              <p className="ml-auto font-mono text-[10px] text-faint">
                {live.length} players running, all muted
              </p>
            )}
          </div>

          {SHELVES.map((name) => {
            const shown = name === "live" ? live : ended;
            return (
              <div
                key={name}
                role="tabpanel"
                id={`wall-panel-${name}`}
                aria-labelledby={`wall-tab-${name}`}
                hidden={tab !== name}
              >
                {/* The inactive shelf unmounts rather than hiding. A hidden
                    grid of embeds is either a dozen players running behind a
                    `display:none` — the connection-pool problem the tiles
                    already guard against — or lazy frames that never load at
                    all, depending on the browser. Neither is worth keeping. */}
                {tab === name &&
                  (shown.length === 0 ? (
                    <p className="py-10 text-center font-mono text-[11px] text-faint">
                      {name === "live"
                        ? "Nothing on air. Everything you've put up has ended."
                        : "Nothing has ended yet."}
                    </p>
                  ) : (
                    <div className={`grid gap-5 ${cols}`}>
                      {shown.map((s) => (
                        <Monitor
                          key={s.videoId}
                          stream={s}
                          mode={mode}
                          onRemove={() => write(() => removeStream(s.videoId))}
                        />
                      ))}
                    </div>
                  ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function Monitor({
  stream,
  mode,
  onRemove,
}: {
  stream: Stream;
  mode: Mode;
  onRemove: () => void;
}) {
  const state = cardState(stream);
  const off = shelf(stream) === "ended";
  const channelUrl = safeHttpUrl(stream.channelUrl);
  // An ended broadcast never takes a player. In monitors mode the embed would
  // autoplay the recording from 0:00, so the Ended tab would be a grid of VODs
  // all restarting at once — which is not a monitor wall. Unconfirmed streams
  // keep their player: without a key that is every stream on the wall.
  const playing = mode === "monitors" && !off;

  return (
    <article
      className={`group border bg-panel transition-colors ${
        state === "live"
          ? "border-tally/60 hover:border-tally"
          : off
            ? "border-edge-soft hover:border-edge"
            : "border-edge-soft hover:border-amber/50"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-edge-soft bg-ink-2 px-2.5 py-1.5">
        {state === "live" ? (
          <LiveBadge />
        ) : (
          <span className="border border-edge px-1.5 py-0.5 font-mono text-[9px] tracking-[0.16em] text-faint uppercase">
            {/* "Ended" is only ever said about something that actually ran; a
                video that was never a broadcast says so instead, and a Twitch
                channel that isn't broadcasting says "Offline" — there is no
                video there at all. `stateLabel` holds that whole decision. */}
            {stateLabel(stream)}
          </span>
        )}
        {stream.viewers !== undefined && (
          <span className="font-mono text-[10px] text-muted tabular-nums">
            {compact(stream.viewers)} watching
          </span>
        )}
        {/* Which of these you chose and which the site found is worth being able
            to see — it is what the sweep and the ✕ behave differently about. */}
        {stream.sourcedAt !== undefined && (
          <span
            title="Found by keyword, not added by you"
            className="font-mono text-[9px] tracking-[0.16em] text-faint uppercase"
          >
            Sourced
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Take ${stream.title} off the wall`}
          className="ml-auto px-1 font-mono text-[11px] text-faint transition-colors hover:text-del"
        >
          ✕
        </button>
      </div>

      <div className="relative aspect-video bg-black">
        {playing ? (
          <MonitorFrame stream={stream} />
        ) : (
          <Link href={watchHref(stream.videoId)} className="absolute inset-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={stream.thumbnail}
              alt=""
              loading="lazy"
              className={`h-full w-full object-cover transition-opacity ${
                off ? "opacity-60 group-hover:opacity-85" : "opacity-85 group-hover:opacity-100"
              }`}
            />
          </Link>
        )}
      </div>

      <div className="p-3">
        <Link href={watchHref(stream.videoId)}>
          <h3
            className={`line-clamp-2 text-sm leading-snug font-semibold transition-colors ${
              off ? "text-muted hover:text-bone" : "text-bone hover:text-amber"
            }`}
          >
            {stream.title}
          </h3>
        </Link>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-faint">
          {channelUrl ? (
            <a
              href={channelUrl}
              target="_blank"
              rel="noreferrer"
              className="text-teal hover:underline"
            >
              {stream.channel}
            </a>
          ) : (
            <span>{stream.channel}</span>
          )}
          <span aria-hidden>·</span>
          <Link href={watchHref(stream.videoId)} className="hover:text-bone">
            Open
          </Link>
        </p>
      </div>
    </article>
  );
}

/**
 * A live tile. The embed is muted and driven by nobody — but YouTube still
 * paints its own chrome (title bar, avatar, share, watch-later, the logo)
 * whenever the pointer enters the frame, and paints a play button and poster
 * while it is still warming up. Neither belongs on the wall.
 *
 * The chrome lives inside a cross-origin iframe, so it can't be removed; it
 * can only be kept from being summoned. The link on top eats every hover and
 * click — doubling as the tile's own click target, which the poster mode
 * already had — and the tile's own thumbnail covers the warm-up.
 *
 * That warm-up cover used to be a black slate, which is the "tuning in" black
 * screen this ticket is about. It is now the stream's own poster: the same
 * image the poster mode shows, so switching modes no longer flashes black and
 * the tile is never a hole in the wall.
 *
 * The reveal is still a timer rather than an event, and that is a real
 * limitation worth stating: these tiles are raw iframes with no `enablejsapi`,
 * so there is no PLAYING event to listen for. Giving a dozen tiles a live
 * `YT.Player` each is a bigger change than this ticket, and it costs more than
 * it buys now that what sits under the timer is a picture rather than black.
 */
function MonitorFrame({ stream }: { stream: Stream }) {
  const [warm, setWarm] = useState(false);
  // Twitch refuses to be framed without a `parent` matching this page's
  // hostname exactly, and a hostname only exists in a browser — so the embed
  // URL cannot be built during render. Until it is, the tile is its poster,
  // which is what it would have been showing anyway.
  const [host, setHost] = useState<string | null>(null);

  useEffect(() => {
    setHost(window.location.hostname);
  }, []);

  useEffect(() => {
    setWarm(false);
    // Not tied to the iframe's load event: the frame fires load long before
    // the picture arrives, and the poster and chrome show in the gap.
    const id = setTimeout(() => setWarm(true), YT_CHROME_MS);
    return () => clearTimeout(id);
  }, []);

  const source = parseKey(stream.videoId);
  const src =
    source && host
      ? embedFor(source, { parent: host, autoplay: true, muted: true, controls: false })
      : null;

  return (
    <>
      {src && (
        <iframe
          src={src}
          title={stream.title}
          allow="autoplay; encrypted-media; picture-in-picture"
          // A four-wide grid mounts a dozen autoplaying embeds at once and
          // saturates the connection pool; off-screen tiles wait their turn.
          loading="lazy"
          className="absolute inset-0 h-full w-full"
        />
      )}
      {/* The poster stays mounted and dissolves, so the hand-off to the first
          decoded frame is a cross-fade rather than a hard cut to whatever the
          embed happens to be showing at that instant. Same treatment as the
          watch player's own poster, for the same reason. */}
      <img
        src={stream.thumbnail}
        alt=""
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
          warm && src ? "opacity-0" : "opacity-100"
        }`}
      />
      <span
        className={`pointer-events-none absolute bottom-2 left-2 border border-edge bg-ink/85 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.16em] text-bone uppercase transition-opacity duration-300 ${
          warm || !src ? "opacity-0" : "opacity-100"
        }`}
      >
        Tuning in…
      </span>
      <Link
        href={watchHref(stream.videoId)}
        aria-label={`Watch ${stream.title}`}
        className="absolute inset-0"
      />
    </>
  );
}
