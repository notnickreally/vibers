"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LiveBadge, Tag } from "@/components/ui/bits";
import type { Relay } from "@/lib/mock/types";
import { findRelay, isBare, relaySource, removeRelay, saveRelay } from "@/lib/relay";
import { embedUrl, watchUrl } from "@/lib/youtube";

/**
 * A relayed stream. This is deliberately *not* a run page: there is no declared
 * goal, no Prompt-Cam, no viewer count and no vibe meter, because none of those
 * would be true. The video is the whole thing, plus whatever the person who
 * relayed it chose to add — always credited to them.
 */
export function RelayPlayer({ relay: fromLink }: { relay: Relay }) {
  const [relay, setRelay] = useState<Relay>(fromLink);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // A bare link can be filled in by whatever you saved locally.
    const local = findRelay(fromLink.videoId);
    if (local) {
      setSaved(true);
      if (isBare(fromLink)) setRelay(local);
    }
  }, [fromLink]);

  const bare = isBare(relay);

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-b-0 border-edge-soft bg-ink-2 px-3 py-2">
          <LiveBadge label="RELAY" />
          <p className="font-mono text-[11px] text-muted">Carried from YouTube</p>
          <p className="ml-auto font-mono text-[10px] tracking-[0.14em] text-faint">
            {relay.videoId}
          </p>
        </div>

        <div className="relative aspect-video border-x border-edge-soft bg-[#0c0812]">
          <iframe
            src={embedUrl(relaySource(relay))}
            title={relay.title ?? `YouTube stream ${relay.videoId}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        </div>

        {/* Attribution first, because on a relay it is the most important fact
            on the page. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-edge-soft bg-panel px-3 py-2.5">
          <p className="eyebrow shrink-0">Source</p>
          <p className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed text-faint">
            This stream belongs to its YouTube creator. vibers.tv plays the original
            video unmodified and adds nothing to it.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={watchUrl(relaySource(relay))}
              target="_blank"
              rel="noreferrer"
              className="border border-edge px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-teal uppercase transition-colors hover:border-teal"
            >
              Watch on YouTube ↗
            </a>
            <Link
              href={`/report?v=${relay.videoId}`}
              className="border border-edge px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-muted uppercase transition-colors hover:border-del hover:text-del"
            >
              Report
            </Link>
          </div>
        </div>
      </div>

      {/* Whatever was filled in — and nothing more. */}
      <div className="border border-edge-soft p-5">
        {bare ? (
          <>
            <p className="eyebrow">No description</p>
            <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
              Nobody has written anything about this stream, and vibers.tv won&apos;t
              invent it. Whatever the creator is doing, the video is the only honest
              account of it.
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">
              Added by {relay.relayedBy ? `@${relay.relayedBy}` : "whoever relayed this"}
            </p>
            {relay.title && (
              <h1 className="mt-2 font-display text-2xl leading-snug font-semibold text-bone">
                {relay.title}
              </h1>
            )}
            {relay.note && (
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{relay.note}</p>
            )}
            {(relay.tool || relay.stacks?.length) && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {relay.tool && <Tag>{relay.tool}</Tag>}
                {relay.stacks?.map((s) => <Tag key={s}>{s}</Tag>)}
              </div>
            )}
            <p className="mt-4 font-mono text-[10px] leading-relaxed text-faint">
              Written by the person who relayed this, not by the creator. Nothing here is
              a statement from them.
            </p>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            if (saved) {
              removeRelay(relay.videoId);
              setSaved(false);
            } else {
              saveRelay(relay);
              setSaved(true);
            }
          }}
          className={`border px-4 py-2 font-mono text-[11px] tracking-[0.12em] uppercase transition-colors ${
            saved
              ? "border-amber text-amber hover:border-del hover:text-del"
              : "border-edge text-bone hover:border-amber hover:text-amber"
          }`}
        >
          {saved ? "Saved to your relays" : "Save to your relays"}
        </button>
        <Link
          href={`/relay?edit=${relay.videoId}`}
          className="border border-edge px-4 py-2 font-mono text-[11px] tracking-[0.12em] text-muted uppercase transition-colors hover:border-teal hover:text-teal"
        >
          {bare ? "Add a description" : "Edit description"}
        </Link>
      </div>
    </div>
  );
}
