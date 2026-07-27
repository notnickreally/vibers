"use client";

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AddStream } from "@/components/wall/add-stream";
import { EmptyState, WallSkeleton } from "@/components/states";
import { LiveBadge } from "@/components/ui/bits";
import { compact } from "@/lib/format";
import { YT_CHROME_MS } from "@/lib/player-time";
import { safeHttpUrl } from "@/lib/youtube";
import {
  cardState,
  initialShelf,
  listStreams,
  partition,
  refreshLiveness,
  removeStream,
  type Shelf,
  shelf,
  type Stream,
} from "@/lib/stream";

/**
 * The wall: every stream you've put on the network, as a bank of monitors.
 *
 * Two modes, because they trade off against each other. **Posters** is the
 * default and shows thumbnails — cheap, quiet, scrolls forever. **Monitors**
 * swaps them for live muted players, which is the view worth having open on a
 * second screen and costs one embed per tile.
 *
 * And two tabs, because a wall is about what is on air. **Live** is the wall
 * proper; **Ended** is where a broadcast goes when it finishes, so a stream
 * that ended three weeks ago stops taking up a monitor. Liveness is re-asked
 * on load — `isLive` is stamped when a stream is added, and believing that
 * forever is how a finished stream stays on the Live tab for good.
 */

type Mode = "posters" | "monitors";
type Size = 2 | 3 | 4;

const SHELVES: Shelf[] = ["live", "ended"];
const SHELF_LABEL: Record<Shelf, string> = { live: "Live", ended: "Ended" };

export function MonitorWall() {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("posters");
  const [size, setSize] = useState<Size>(3);
  const [tab, setTab] = useState<Shelf>("live");
  // Once someone has picked a tab, the refresh landing must not pull it back.
  const touchedRef = useRef(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const stored = listStreams();
    setStreams(stored);
    setTab(initialShelf(stored));
    setLoading(false);

    let cancelled = false;
    refreshLiveness().then((next) => {
      if (cancelled) return;
      setStreams(next);
      if (!touchedRef.current) setTab(initialShelf(next));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { live, ended } = useMemo(() => partition(streams), [streams]);
  const counts: Record<Shelf, number> = { live: live.length, ended: ended.length };

  const cols = {
    2: "sm:grid-cols-1 lg:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  }[size];

  const selectTab = useCallback((next: Shelf) => {
    touchedRef.current = true;
    setTab(next);
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

      {loading ? (
        <div className="mt-10">
          <WallSkeleton count={6} />
        </div>
      ) : streams.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            slate="Nothing on the wall"
            title="Put a stream up"
            body="Paste the URL of a YouTube live stream above. It gets its real title and channel from YouTube and stays on your wall until you take it down."
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
              {(["posters", "monitors"] as Mode[]).map((m) => (
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
                          onRemove={() => setStreams(removeStream(s.videoId))}
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
            {/* "Ended" is only ever said about something that actually ran.
                A video that was never a broadcast says so instead. */}
            {state === "ended" ? "Ended" : state === "video" ? "Video" : "Stream"}
          </span>
        )}
        {stream.viewers !== undefined && (
          <span className="font-mono text-[10px] text-muted tabular-nums">
            {compact(stream.viewers)} watching
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
          <Link href={`/watch/${stream.videoId}`} className="absolute inset-0">
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
        <Link href={`/watch/${stream.videoId}`}>
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
          <Link href={`/watch/${stream.videoId}`} className="hover:text-bone">
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

  useEffect(() => {
    setWarm(false);
    // Not tied to the iframe's load event: the frame fires load long before
    // the picture arrives, and the poster and chrome show in the gap.
    const id = setTimeout(() => setWarm(true), YT_CHROME_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${stream.videoId}?autoplay=1&mute=1&controls=0&rel=0&iv_load_policy=3&playsinline=1`}
        title={stream.title}
        allow="autoplay; encrypted-media; picture-in-picture"
        // A four-wide grid mounts a dozen autoplaying embeds at once and
        // saturates the connection pool; off-screen tiles wait their turn.
        loading="lazy"
        className="absolute inset-0 h-full w-full"
      />
      {/* The poster stays mounted and dissolves, so the hand-off to the first
          decoded frame is a cross-fade rather than a hard cut to whatever the
          embed happens to be showing at that instant. Same treatment as the
          watch player's own poster, for the same reason. */}
      <img
        src={stream.thumbnail}
        alt=""
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
          warm ? "opacity-0" : "opacity-100"
        }`}
      />
      <span
        className={`pointer-events-none absolute bottom-2 left-2 border border-edge bg-ink/85 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.16em] text-bone uppercase transition-opacity duration-300 ${
          warm ? "opacity-0" : "opacity-100"
        }`}
      >
        Tuning in…
      </span>
      <Link
        href={`/watch/${stream.videoId}`}
        aria-label={`Watch ${stream.title}`}
        className="absolute inset-0"
      />
    </>
  );
}
