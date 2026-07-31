"use client";

import { Fragment } from "react";
import { readDescription, type Segment } from "@/lib/description";
import type { Provider } from "@/lib/source";

/**
 * The channel's own description, drawn.
 *
 * `lib/description.ts` decides what the text *is* — which runs are links, which
 * are chapter marks — and this decides nothing except how each kind looks. That
 * split is what lets the deciding be tested at all: it is a string in and a
 * list out, in a suite with no DOM.
 *
 * It stays one block element rather than a stack of paragraphs, and that is
 * load-bearing. The collapsed state is `line-clamp-6`, which is
 * `-webkit-box` + `-webkit-line-clamp` underneath, and those only clamp the
 * lines of the box they are on — wrap the paragraphs in a div and the clamp
 * silently stops clamping, showing the full description with a Show more button
 * under it. So the paragraph breaks stay where they have always been: real
 * newlines, rendered by `whitespace-pre-wrap`, with everything here inline
 * inside them.
 */
export function StreamDescription({
  description,
  provider,
  className,
  onSeek,
}: {
  description: string;
  provider?: Provider;
  className?: string;
  /** Absent when there is no player to move — the marks then read as text. */
  onSeek?: (seconds: number) => void;
}) {
  const segments = readDescription(description, provider);

  return (
    <p className={className}>
      {segments.map((segment) => (
        <Piece key={`${segment.kind}-${segment.at}`} segment={segment} onSeek={onSeek} />
      ))}
    </p>
  );
}

function Piece({ segment, onSeek }: { segment: Segment; onSeek?: (seconds: number) => void }) {
  // Teal is what a link out looks like everywhere else on this site, and the
  // description is the one place a lot of them arrive at once — so they are
  // underlined on hover like the channel link above them, and nothing more.
  if (segment.kind === "link" || segment.kind === "tag") {
    return (
      <a
        href={segment.href}
        target="_blank"
        rel="noreferrer"
        className="text-teal hover:underline"
      >
        {segment.text}
      </a>
    );
  }

  // A chapter mark is a control on this page rather than a way off it, so it
  // takes the amber the seek bar and the Show more button take, and it is a
  // button — a thing that moves the picture is not a link, and a reader
  // middle-clicking it should not get a new tab of nothing.
  if (segment.kind === "time") {
    if (!onSeek) return <Fragment>{segment.text}</Fragment>;
    const { seconds } = segment;
    return (
      <button
        type="button"
        onClick={() => onSeek(seconds)}
        className="font-mono text-amber tabular-nums hover:underline"
      >
        {segment.text}
      </button>
    );
  }

  return <Fragment>{segment.text}</Fragment>;
}
