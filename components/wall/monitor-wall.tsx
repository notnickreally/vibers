"use client";

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AddStream } from "@/components/wall/add-stream";
import { EmptyState, WallSkeleton } from "@/components/states";
import { LiveBadge } from "@/components/ui/bits";
import { compact } from "@/lib/format";
import { YT_CHROME_MS } from "@/lib/player-time";
import { embedFor, parseKey, watchHref } from "@/lib/source";
import { safeHttpUrl } from "@/lib/youtube";
import {
  cardState,
  DEFAULT_MODE,
  DEFAULT_VIEW,
  listStreams,
  type Mode,
  partition,
  refreshLiveness,
  removeStream,
  type Shelf,
  shelf,
  shelvesFor,
  stateLabel,
  sourceStreams,
  type Stream,
  WALL_VIEWS,
  WallError,
  type WallView,
} from "@/lib/stream";

/**
 * The wall: every stream you've put on the network, as a bank of monitors.
 *
 * One mode, and it is the one the product is named for: live muted players, one
 * embed per tile, the view worth having open on a second screen. There used to
 * be a switch to the cheap poster view beside the grid control; it is gone.
 * Nobody arrived at a wall of running monitors wanting to turn them into
 * stills, and a toggle whose second position undoes the whole point of the page
 * is a control that only ever costs. Posters still draw — an ended broadcast
 * and a warming-up tile are both a thumbnail — they just aren't a mode you pick.
 *
 * What is left above the wall is the two things that actually shape the feed,
 * on one line: the **All / Live / Ended** tabs at the reading edge, and how many
 * tiles run per row at the far end of the same rule.
 *
 * And one feed, in three views. The wall reads top to bottom: what is on air
 * first, everything that has finished stacked underneath it, so an ended
 * broadcast is a scroll away rather than behind a tab. The tab bar stays, and
 * gets its own job back — **All**, **Live**, **Ended** filter that feed, rather
 * than being the only route to half the wall. Stacking both shelves costs
 * nothing the Live view didn't already cost: an ended tile takes no player in
 * any view, so the half below the fold is a grid of pictures.
 *
 * Liveness is re-asked on load — `isLive` is stamped when a stream is added,
 * and believing that forever is how a finished stream keeps a monitor for good.
 *
 * The wall is one wall, shared: everything below reads and writes the streams
 * table in Neon through `/api/streams`, so what is on screen is what everyone
 * else is looking at. That makes the store fallible in a way a localStorage
 * one never was, so there is a failure path — and it is a message, never a
 * fallback. An empty grid where a full wall should be is a lie that looks
 * exactly like the truth.
 *
 * Shared cuts both ways, and the ✕ is where it bites. Putting a stream up is
 * anybody's — that is what the box at the top is for — but taking one off
 * happens to everybody at once and there is no undo, so it stays with whoever
 * holds the panel. `isAdmin` decides whether the ✕ is *drawn*, never whether it
 * is allowed: `/api/streams` checks the cookie on every `DELETE` itself, because
 * a page that hides a button proves nothing to a route `curl` can reach. Same
 * split, and the same sentence said out loud, as `components/channels/channel-list.tsx`.
 */

type Size = 2 | 3 | 4;

const VIEW_LABEL: Record<WallView, string> = { all: "All", live: "Live", ended: "Ended" };
const SHELF_LABEL: Record<Shelf, string> = { live: "Live", ended: "Ended" };
/** What a shelf's section says when the feed reaches it and it holds nothing. */
const SHELF_EMPTY: Record<Shelf, string> = {
  live: "Nothing on air. Everything you've put up has ended.",
  ended: "Nothing has ended yet.",
};

export function MonitorWall({
  /** Whether to draw the ✕ buttons. The route decides whether they work. */
  isAdmin = false,
}: {
  isAdmin?: boolean;
}) {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  // Not state any more: the wall draws monitors, full stop. The switch that
  // used to sit above the grid is gone, so the only thing left to say about the
  // mode is which one it is — and the tiles still need to be told, because an
  // ended broadcast draws its poster in either.
  const mode: Mode = DEFAULT_MODE;
  const [size, setSize] = useState<Size>(3);
  const [view, setView] = useState<WallView>(DEFAULT_VIEW);
  // Sourcing still runs; it just isn't narrated any more. What is left of it
  // here is the one bit the wall itself needs: whether a run is still in
  // flight, so an empty wall waits on a skeleton instead of saying it is empty.
  const [sourcing, setSourcing] = useState(false);
  const [error, setError] = useState("");
  // Which tile is mid-removal, so its ✕ can say so. One at a time is not a
  // constraint the wall imposes — it is simply what a single pointer does.
  const [removing, setRemoving] = useState<string | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;

    // The three calls below each land a fresher wall, and none of them touches
    // the selected view any more. They used to: the wall opened on a shelf, so
    // a load that found nothing live had to move you. The default view holds
    // both shelves, so there is nothing left to second-guess — whatever you
    // picked survives every landing.
    function land(next: Stream[]) {
      if (cancelled) return;
      setStreams(next);
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
        setSourcing(true);
        return sourceStreams();
      })
      .then((found) => {
        if (cancelled || !found) return;
        land(found.streams);
        setSourcing(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Said, never swallowed. The wall is remote now, and a wall that can't
        // be reached has to look different from a wall with nothing on it.
        setError(err instanceof Error ? err.message : "The wall isn't answering.");
        setSourcing(false);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shelves = useMemo(() => partition(streams), [streams]);
  const { live, ended } = shelves;
  const counts: Record<WallView, number> = {
    all: live.length + ended.length,
    live: live.length,
    ended: ended.length,
  };
  const cols = {
    2: "sm:grid-cols-1 lg:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  }[size];

  // Every write goes through here so a failed one reports itself rather than
  // leaving the grid showing a change that never reached the database.
  const write = useCallback(async (action: () => Promise<Stream[]>) => {
    try {
      setStreams(await action());
      setError("");
    } catch (err) {
      // A 401 only ever comes back from a removal, and only for a session that
      // went away underneath us — expired, or a credential changed. The button
      // was on screen a moment ago, so a red box explaining a refusal would be
      // the wrong answer; the gate is. Same move `channel-list.tsx` makes.
      if (err instanceof WallError && err.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      setError(err instanceof Error ? err.message : "The wall isn't answering.");
    }
  }, []);

  const remove = useCallback(
    async (videoId: string) => {
      setRemoving(videoId);
      try {
        await write(() => removeStream(videoId));
      } finally {
        setRemoving(null);
      }
    },
    [write],
  );

  // Arrow keys move between tabs, Home/End jump to the ends — the half of the
  // tabs pattern that a plain row of buttons doesn't give you for free.
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = WALL_VIEWS.indexOf(view);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % WALL_VIEWS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + WALL_VIEWS.length) % WALL_VIEWS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = WALL_VIEWS.length - 1;
    else return;
    event.preventDefault();
    setView(WALL_VIEWS[next]);
    tabRefs.current[next]?.focus();
  }

  const tabBase =
    "border-b-2 px-1 pb-2 font-mono text-[11px] tracking-[0.12em] uppercase transition-colors";

  function tabClass(name: WallView) {
    return view === name
      ? `${tabBase} border-amber text-amber`
      : `${tabBase} border-transparent text-faint hover:text-bone`;
  }

  return (
    <div>
      <AddStream onAdded={setStreams} />

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
      {error && streams.length === 0 ? null : loading || (streams.length === 0 && sourcing) ? (
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
          <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-edge-soft">
            {/* Still a tablist, and still the thing that decides what the wall
                shows — it just isn't load-bearing for reaching the ended half
                any more, because All already stacks it under the live one. */}
            <div role="tablist" aria-label="Wall" className="flex items-center gap-5">
              {WALL_VIEWS.map((name, i) => (
                <button
                  key={name}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`wall-tab-${name}`}
                  aria-selected={view === name}
                  aria-controls={`wall-panel-${name}`}
                  // Roving tab stop: the tablist is one stop, arrows move inside it.
                  tabIndex={view === name ? 0 : -1}
                  onClick={() => setView(name)}
                  onKeyDown={onTabKeyDown}
                  className={tabClass(name)}
                >
                  <span className="flex items-center gap-2">
                    {VIEW_LABEL[name]}
                    <span className="tabular-nums opacity-70">{counts[name]}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* How wide the wall runs, at the far end of the same rule the tabs
                sit on: the two things that shape the feed, one line, one border,
                the filters at the reading edge and the size at the other. It
                needs no "Grid" label — three numbers next to a wall of tiles
                only mean one thing, and the word was there to fill a row that no
                longer exists. */}
            <div className="ml-auto flex items-center gap-2 pb-1.5">
              {([2, 3, 4] as Size[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  // The word that used to sit in front of these is gone, so each
                  // button has to say for itself what its bare numeral means.
                  aria-label={`${s} per row`}
                  aria-pressed={size === s}
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
          </div>

          {/* What used to be a bare spacer — the last of the old controls row —
              now carries the one rule the wall can't demonstrate by drawing a
              button, said in the row's own spacing. For a visitor the missing
              ✕ is the whole point: nobody should have to press something and
              read a 401 to find out that removal isn't theirs. */}
          <p className={`mt-3 mb-5 font-mono text-[11px] ${isAdmin ? "text-muted" : "text-faint"}`}>
            {isAdmin
              ? "Signed in — ✕ takes a stream off the wall for everybody, and a sourced one stays off."
              : "Anyone can put a stream up. Taking one off is an operator's — it comes off for everybody."}
          </p>

          {WALL_VIEWS.map((name) => {
            const stacked = shelvesFor(name);
            return (
              <div
                key={name}
                role="tabpanel"
                id={`wall-panel-${name}`}
                aria-labelledby={`wall-tab-${name}`}
                hidden={view !== name}
                // The gap between stacked shelves lives here rather than on the
                // section, so a shelf that renders nothing leaves no gap behind.
                className="space-y-10"
              >
                {/* The unselected views unmount rather than hide. A hidden grid
                    of embeds is either a dozen players running behind a
                    `display:none` — the connection-pool problem the tiles
                    already guard against — or lazy frames that never load at
                    all, depending on the browser. Neither is worth keeping, and
                    a view that stacks both shelves would otherwise mount the
                    live grid three times over. */}
                {view === name &&
                  stacked.map((section) => (
                    <ShelfSection
                      key={section}
                      shelf={section}
                      streams={shelves[section]}
                      mode={mode}
                      cols={cols}
                      // In a single-shelf view the tab above is already the
                      // heading; stacked, the sections have to name themselves,
                      // and that name is what you scroll down to find.
                      titled={stacked.length > 1}
                      isAdmin={isAdmin}
                      removing={removing}
                      onRemove={remove}
                    />
                  ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * One shelf of the feed: a heading, then its grid.
 *
 * The heading is conditional because it is only ever an answer to a question
 * the page is asking. In a filtered view the tab is lit and says the same word
 * an inch above, so a heading there is the label twice. Stacked, it is the only
 * thing that tells you where the live half stopped and the ended half started —
 * which is the seam this whole feed exists to make scrollable.
 *
 * An empty shelf behaves the same way, and for the same reason. Filtered, "there
 * is nothing here" is the answer to what you asked, so it is said out loud.
 * Stacked, it is a paragraph of nothing wedged between the wall and its end —
 * the tab bar already carries the count — so the section simply doesn't appear.
 */
function ShelfSection({
  shelf: name,
  streams,
  mode,
  cols,
  titled,
  isAdmin,
  removing,
  onRemove,
}: {
  shelf: Shelf;
  streams: Stream[];
  mode: Mode;
  cols: string;
  titled: boolean;
  isAdmin: boolean;
  removing: string | null;
  onRemove: (videoId: string) => void;
}) {
  if (streams.length === 0) {
    if (titled) return null;
    return (
      <p className="py-10 text-center font-mono text-[11px] text-faint">{SHELF_EMPTY[name]}</p>
    );
  }

  return (
    <section aria-label={titled ? SHELF_LABEL[name] : undefined}>
      {titled && (
        <h2 className="eyebrow mb-4 flex items-center gap-2 border-b border-edge-soft pb-2">
          {SHELF_LABEL[name]}
          <span className="tabular-nums opacity-70">{streams.length}</span>
        </h2>
      )}
      <div className={`grid gap-5 ${cols}`}>
        {streams.map((s) => (
          <Monitor
            key={s.videoId}
            stream={s}
            mode={mode}
            // Drawn for an operator only. `/api/streams` re-checks the cookie
            // on every `DELETE`, so this decides the picture, not the rule.
            canRemove={isAdmin}
            removing={removing === s.videoId}
            onRemove={() => onRemove(s.videoId)}
          />
        ))}
      </div>
    </section>
  );
}

function Monitor({
  stream,
  mode,
  canRemove,
  removing,
  onRemove,
}: {
  stream: Stream;
  mode: Mode;
  canRemove: boolean;
  removing: boolean;
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
        {/* An operator's, and only drawn for one. A visitor gets no button
            rather than a button that 401s — the head simply ends here. */}
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            aria-label={`Take ${stream.title} off the wall`}
            className="ml-auto px-1 font-mono text-[11px] text-faint transition-colors hover:text-del disabled:text-muted"
          >
            {removing ? "…" : "✕"}
          </button>
        )}
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
