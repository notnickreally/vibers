"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AddStream } from "@/components/wall/add-stream";
import { EmptyState, WallSkeleton } from "@/components/states";
import { LiveBadge } from "@/components/ui/bits";
import { compact } from "@/lib/format";
import { YT_CHROME_MS } from "@/lib/player-time";
import { listStreams, removeStream, type Stream } from "@/lib/stream";

/**
 * The wall: every stream you've put on the network, as a bank of monitors.
 *
 * Two modes, because they trade off against each other. **Posters** is the
 * default and shows thumbnails — cheap, quiet, scrolls forever. **Monitors**
 * swaps them for live muted players, which is the view worth having open on a
 * second screen and costs one embed per tile.
 */

type Mode = "posters" | "monitors";
type Size = 2 | 3 | 4;

export function MonitorWall() {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("posters");
  const [size, setSize] = useState<Size>(3);

  useEffect(() => {
    setStreams(listStreams());
    setLoading(false);
  }, []);

  const cols = {
    2: "sm:grid-cols-1 lg:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
  }[size];

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
          <div className="mt-10 mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-edge-soft pb-3">
            <p className="eyebrow">
              On the wall · <span className="text-bone">{streams.length}</span>
            </p>

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

            {mode === "monitors" && (
              <p className="ml-auto font-mono text-[10px] text-faint">
                {streams.length} players running, all muted
              </p>
            )}
          </div>

          <div className={`grid gap-5 ${cols}`}>
            {streams.map((s) => (
              <Monitor
                key={s.videoId}
                stream={s}
                mode={mode}
                onRemove={() => setStreams(removeStream(s.videoId))}
              />
            ))}
          </div>
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
  return (
    <article className="group border border-edge-soft bg-panel transition-colors hover:border-amber/50">
      <div className="flex items-center gap-2 border-b border-edge-soft bg-ink-2 px-2.5 py-1.5">
        {stream.isLive ? (
          <LiveBadge />
        ) : (
          <span className="border border-edge px-1.5 py-0.5 font-mono text-[9px] tracking-[0.16em] text-faint uppercase">
            Stream
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
        {mode === "monitors" ? (
          <MonitorFrame stream={stream} />
        ) : (
          <Link href={`/watch/${stream.videoId}`} className="absolute inset-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={stream.thumbnail}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover opacity-85 transition-opacity group-hover:opacity-100"
            />
          </Link>
        )}
      </div>

      <div className="p-3">
        <Link href={`/watch/${stream.videoId}`}>
          <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-bone transition-colors hover:text-amber">
            {stream.title}
          </h3>
        </Link>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-faint">
          {stream.channelUrl ? (
            <a
              href={stream.channelUrl}
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
      {!warm && (
        <>
          <img
            src={stream.thumbnail}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span className="absolute bottom-2 left-2 border border-edge bg-ink/85 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.16em] text-bone uppercase">
            Tuning in…
          </span>
        </>
      )}
      <Link
        href={`/watch/${stream.videoId}`}
        aria-label={`Watch ${stream.title}`}
        className="absolute inset-0"
      />
    </>
  );
}
