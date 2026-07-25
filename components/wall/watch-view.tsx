"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CleanPlayer } from "@/components/player/clean-player";
import { ErrorState } from "@/components/states";
import { LiveBadge } from "@/components/ui/bits";
import { compact } from "@/lib/format";
import { addStream, findStream, listStreams, lookup, type Stream } from "@/lib/stream";

/**
 * One stream, full size. Metadata is looked up live rather than trusted from
 * whatever is cached, so an open tab shows the video's real current title.
 */
export function WatchView({ videoId }: { videoId: string }) {
  const [stream, setStream] = useState<Stream | null>(null);
  const [others, setOthers] = useState<Stream[]>([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [onWall, setOnWall] = useState(false);

  useEffect(() => {
    const cached = findStream(videoId);
    if (cached) {
      setStream(cached);
      setOnWall(true);
    }
    setOthers(listStreams().filter((s) => s.videoId !== videoId));

    let cancelled = false;
    lookup(videoId)
      .then((meta) => {
        if (cancelled) return;
        setStream({ ...meta, addedAt: cached?.addedAt ?? 0 });
      })
      .catch((err: unknown) => {
        if (cancelled || cached) return;
        setError(err instanceof Error ? err.message : "Couldn't load this video.");
      });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  if (error) {
    return (
      <ErrorState
        code="youtube/lookup-failed"
        title="That video wouldn't load"
        body={error}
        action={
          <Link
            href="/"
            className="bg-amber px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
          >
            Back to the wall
          </Link>
        }
      />
    );
  }

  const description = stream?.description ?? "";
  const isLong = description.length > 420;

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <CleanPlayer videoId={videoId} isLive={stream?.isLive} />

        {/* Everything YouTube would have put on the picture, put underneath. */}
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-3">
            {stream?.isLive && <LiveBadge />}
            {stream?.viewers !== undefined && (
              <span className="font-mono text-[11px] text-muted tabular-nums">
                {compact(stream.viewers)} watching
              </span>
            )}
            <a
              href={`https://www.youtube.com/watch?v=${videoId}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto border border-edge px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] text-teal uppercase transition-colors hover:border-teal"
            >
              Watch on YouTube ↗
            </a>
            <Link
              href={`/report?v=${videoId}`}
              className="border border-edge px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] text-muted uppercase transition-colors hover:border-del hover:text-del"
            >
              Report
            </Link>
          </div>

          <h1 className="mt-4 font-display text-2xl leading-snug font-semibold text-bone sm:text-3xl">
            {stream?.title ?? "Loading…"}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {stream?.channelUrl ? (
              <a
                href={stream.channelUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm text-teal hover:underline"
              >
                {stream.channel}
              </a>
            ) : (
              stream && <span className="font-mono text-sm text-muted">{stream.channel}</span>
            )}
            {stream && (
              <button
                type="button"
                onClick={() => {
                  if (onWall) return;
                  addStream(stream);
                  setOnWall(true);
                }}
                disabled={onWall}
                className="border border-edge px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors disabled:text-faint enabled:text-bone enabled:hover:border-amber enabled:hover:text-amber"
              >
                {onWall ? "On your wall" : "Add to wall"}
              </button>
            )}
          </div>

          {description ? (
            <div className="mt-6 border-t border-edge-soft pt-5">
              <p className="eyebrow">Description</p>
              <p
                className={`mt-3 max-w-3xl text-sm leading-relaxed whitespace-pre-wrap text-muted ${
                  isLong && !expanded ? "line-clamp-6" : ""
                }`}
              >
                {description}
              </p>
              {isLong && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-2 font-mono text-[10px] tracking-[0.12em] text-amber uppercase hover:text-bone"
                >
                  {expanded ? "Show less" : "Show more"}
                </button>
              )}
              <p className="mt-4 font-mono text-[10px] text-faint">
                Written by the channel. vibers.tv shows it as published.
              </p>
            </div>
          ) : (
            stream && (
              <p className="mt-6 border-t border-edge-soft pt-5 font-mono text-[11px] leading-relaxed text-faint">
                No description available. Titles and channels come from YouTube&apos;s oEmbed
                endpoint; descriptions need a YouTube Data API key — see the README.
              </p>
            )
          )}
        </div>
      </div>

      {/* The rest of the wall, so you can hop between streams. */}
      <aside className="min-w-0">
        <p className="eyebrow mb-3">Also on your wall</p>
        {others.length === 0 ? (
          <p className="border border-dashed border-edge p-4 font-mono text-[11px] leading-relaxed text-faint">
            Nothing else up yet. Add more streams and they&apos;ll queue here.
          </p>
        ) : (
          <ul className="space-y-3">
            {others.map((s) => (
              <li key={s.videoId}>
                <Link href={`/watch/${s.videoId}`} className="group flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.thumbnail}
                    alt=""
                    loading="lazy"
                    className="h-14 w-24 shrink-0 border border-edge-soft object-cover"
                  />
                  <span className="min-w-0">
                    <span className="line-clamp-2 block text-[13px] leading-snug text-bone group-hover:text-amber">
                      {s.title}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-faint">
                      {s.channel}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/"
          className="mt-4 block border border-edge px-3 py-2 text-center font-mono text-[10px] tracking-[0.12em] text-muted uppercase transition-colors hover:border-amber hover:text-amber"
        >
          Back to the wall
        </Link>
      </aside>
    </div>
  );
}
