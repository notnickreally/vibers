"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LiveChat } from "@/components/chat/live-chat";
import { CleanPlayer } from "@/components/player/clean-player";
import { TwitchPlayer } from "@/components/player/twitch-player";
import { ErrorState } from "@/components/states";
import { StreamWheel } from "@/components/wall/stream-wheel";
import { compact } from "@/lib/format";
import { parseKey, PROVIDER_LABEL, sourceNoun, watchLinkUrl } from "@/lib/source";
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
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
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

        {/* The chat, under the picture. Two tabs: the stream's real YouTube
            live chat, and your own local notes. It stays mounted whatever
            `isLive` turns out to be, so it can't appear or vanish under the
            reader when the live lookup lands — that only decides which tab
            opens, and only until someone picks one. */}
        <LiveChat videoId={videoId} isLive={stream?.isLive} />
      </div>

      {/* The rest of the wall, so you can hop between streams — a wheel with its
          own axle rather than a list in the page's scroll. Beside the picture it
          is pinned and height-bounded, and that is what keeps the stream you
          came for on screen: the wheel turns inside these bounds, and the page
          underneath it doesn't move.

          Two classes here are load-bearing rather than decorative. `self-start`
          is what makes `sticky` mean anything at all — a grid item stretches to
          its row by default, and something already as tall as its containing
          block has nowhere to stick. And `top` clears the site header, which is
          itself sticky at `h-14`; without that the wall pins underneath it. */}
      <aside className="min-w-0 xl:sticky xl:top-[4.25rem] xl:flex xl:max-h-[calc(100vh-5.5rem)] xl:flex-col xl:self-start">
        <p className="eyebrow mb-3 shrink-0">Also on the wall</p>
        {others.length === 0 ? (
          <p className="border border-dashed border-edge p-4 font-mono text-[11px] leading-relaxed text-faint">
            Nothing else up yet. Add more streams and they&apos;ll queue here.
          </p>
        ) : (
          <StreamWheel streams={others} />
        )}
        <Link
          href="/"
          className="mt-4 block shrink-0 border border-edge px-3 py-2 text-center font-mono text-[10px] tracking-[0.12em] text-muted uppercase transition-colors hover:border-amber hover:text-amber"
        >
          Back to the wall
        </Link>
      </aside>
    </div>
  );
}
