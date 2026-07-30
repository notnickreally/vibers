"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LiveChat } from "@/components/chat/live-chat";
import { CleanPlayer } from "@/components/player/clean-player";
import { TwitchPlayer } from "@/components/player/twitch-player";
import { ErrorState } from "@/components/states";
import { compact } from "@/lib/format";
import {
  parseKey,
  PROVIDER_LABEL,
  sourceNoun,
  watchHref,
  watchLinkUrl,
} from "@/lib/source";
import { addStream, listStreams, lookup, type Stream } from "@/lib/stream";
import { safeHttpUrl } from "@/lib/youtube";

/**
 * One stream, full size. Metadata is looked up live rather than trusted from
 * whatever is cached, so an open tab shows the stream's real current title.
 *
 * The picture is whichever player the key calls for — `CleanPlayer` drives
 * YouTube through its IFrame API, `TwitchPlayer` frames Twitch's own — and
 * everything under it is shared, because a title, a channel, a description and
 * a chat are the same furniture whoever is hosting the video.
 */
export function WatchView({ videoId }: { videoId: string }) {
  // The key is the page's whole input, and it has already been through
  // `parseKey` on the server — a segment that doesn't parse is a 404 before
  // this component exists. Parsed again here because what the player needs is
  // the source, not the string.
  const source = parseKey(videoId);
  const [stream, setStream] = useState<Stream | null>(null);
  const [others, setOthers] = useState<Stream[]>([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [onWall, setOnWall] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let cached: Stream | undefined;

    // The wall is remote, so what used to be a synchronous read of the local
    // store is a request now. It runs beside the lookup rather than before it:
    // the two answer different questions, and the picture should not wait on
    // the sidebar. A wall that won't load leaves the sidebar empty and the
    // player alone — this page's job is the one stream.
    listStreams()
      .then((wall) => {
        if (cancelled) return;
        cached = wall.find((s) => s.videoId === videoId);
        if (cached) {
          setStream((current) => current ?? cached ?? null);
          setOnWall(true);
        }
        setOthers(wall.filter((s) => s.videoId !== videoId));
      })
      .catch(() => {});

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

  // Only ever an http(s) link. A stream's channel URL travels through the wall
  // and back out of Postgres, so what lands in the href is not necessarily the
  // URL oEmbed handed us.
  const channelUrl = safeHttpUrl(stream?.channelUrl);

  if (error) {
    return (
      <ErrorState
        code={`${source?.provider ?? "stream"}/lookup-failed`}
        title={`That ${source ? sourceNoun(source) : "stream"} wouldn't load`}
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
    /* Three regions, one grid: the stage, the chat, and the rest of the wall.
       Where the chat lands is a question about room. Given room it goes to the
       *left* of the picture — a chat is a column of short lines, and a 1200px
       one stacked under the fold beside an empty rail was the worst of both
       — and where there is no room it drops back under the picture, which is
       where it has always been.

       The switch is grid placement and nothing else. The chat is the same node
       in the same place in the tree at every width, moved by `col-start` and
       `row-start`, and that is deliberate: re-parenting it would remount the
       `<iframe>`, which is the one thing `LiveChat` spends its whole file
       avoiding — the frame is YouTube's cross-origin `live_chat` document, so a
       remount reloads it and drops whatever session it had signed into. Asking
       CSS rather than measuring also gets the first paint right, before
       hydration, which no measured layout can.

       Where the line falls: the page is capped at 1600px like every other page
       here, so a 340px chat column plus the 320px wall rail still leave the
       picture ~810px from `2xl` (1536px) up. Below that the chat would be taking
       width the picture cannot spare, so it goes back underneath. */
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[340px_minmax(0,1fr)_320px]">
      <div className="min-w-0 xl:col-start-1 xl:row-start-1 2xl:col-start-2">
        {source?.provider === "twitch" ? (
          <TwitchPlayer
            source={source}
            isLive={stream?.isLive}
            title={stream?.title}
            channel={stream?.channel}
          />
        ) : (
          <CleanPlayer
            videoId={videoId}
            isLive={stream?.isLive}
            title={stream?.title}
            channel={stream?.channel}
          />
        )}

        {/* Everything YouTube would have put on the picture, put underneath.
            The title and the live lamp live in the player's own title strip
            above the picture, so they are not repeated here. */}
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-3">
            {stream?.viewers !== undefined && (
              <span className="font-mono text-[11px] text-muted tabular-nums">
                {compact(stream.viewers)} watching
              </span>
            )}
            {source && (
              <a
                href={watchLinkUrl(source)}
                target="_blank"
                rel="noreferrer"
                className="ml-auto border border-edge px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] text-teal uppercase transition-colors hover:border-teal"
              >
                Watch on {PROVIDER_LABEL[source.provider]} ↗
              </a>
            )}
            <Link
              href={`/report?v=${encodeURIComponent(videoId)}`}
              className="border border-edge px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] text-muted uppercase transition-colors hover:border-del hover:text-del"
            >
              Report
            </Link>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {stream && channelUrl ? (
              <a
                href={channelUrl}
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
                  addStream(videoId)
                    .then(() => setOnWall(true))
                    .catch(() => {});
                }}
                disabled={onWall}
                className="border border-edge px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors disabled:text-faint enabled:text-bone enabled:hover:border-amber enabled:hover:text-amber"
              >
                {onWall ? "On the wall" : "Add to wall"}
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

      {/* The chat. Two tabs: the stream's real YouTube live chat, and your own
          local notes. It stays mounted whatever `isLive` turns out to be, so it
          can't appear or vanish under the reader when the live lookup lands —
          that only decides which tab opens, and only until someone picks one.

          It sits after the stream in the source at every width, whichever side
          it is drawn on: the stream is what this page is about, so it reads
          first and, on a narrow screen, stacks first. */}
      <div className="min-w-0 xl:col-start-1 xl:row-start-2 2xl:row-start-1">
        <LiveChat videoId={videoId} isLive={stream?.isLive} />
      </div>

      {/* The rest of the wall, so you can hop between streams. Its rail keeps
          the right-hand column in both wide arrangements — it is the one region
          the chat never trades places with. */}
      <aside className="min-w-0 xl:col-start-2 xl:row-start-1 xl:row-span-2 2xl:col-start-3 2xl:row-span-1">
        <p className="eyebrow mb-3">Also on the wall</p>
        {others.length === 0 ? (
          <p className="border border-dashed border-edge p-4 font-mono text-[11px] leading-relaxed text-faint">
            Nothing else up yet. Add more streams and they&apos;ll queue here.
          </p>
        ) : (
          <ul className="space-y-3">
            {others.map((s) => (
              <li key={s.videoId}>
                <Link href={watchHref(s.videoId)} className="group flex gap-3">
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
