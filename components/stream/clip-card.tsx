import Link from "next/link";
import { Poster } from "@/components/ui/bits";
import { compact } from "@/lib/format";
import { getViber } from "@/lib/mock/data";
import type { Clip } from "@/lib/mock/types";

/** Clips are typed by what happened, not by mood. The type is the headline. */
const KIND_LABEL: Record<Clip["kind"], { text: string; tone: string }> = {
  ship: { text: "Ship moment", tone: "text-add" },
  rescue: { text: "Chat rescue", tone: "text-teal" },
  "rabbit-hole": { text: "Rabbit hole", tone: "text-del" },
  "one-shot": { text: "One-shot", tone: "text-amber" },
};

export function ClipCard({ clip }: { clip: Clip }) {
  const viber = getViber(clip.handle);
  const kind = KIND_LABEL[clip.kind];

  return (
    <article className="group">
      <Link href={`/watch/${clip.handle}`} className="block">
        <Poster
          tone={clip.tone}
          className="aspect-[16/9] transition-colors group-hover:border-amber/60"
        >
          <div className="relative flex h-full flex-col justify-between p-3">
            <div className="flex items-start justify-between">
              <span
                className={`border border-edge bg-ink/70 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase ${kind.tone}`}
              >
                {kind.text}
              </span>
              <span className="bg-ink/70 px-1.5 py-0.5 font-mono text-[10px] text-muted tabular-nums">
                0:{String(clip.seconds).padStart(2, "0")}
              </span>
            </div>
            <p className="font-display text-base leading-snug font-semibold text-bone">
              {clip.title}
            </p>
          </div>
        </Poster>
      </Link>
      <p className="mt-2.5 flex items-center gap-2 font-mono text-[11px] text-faint">
        <Link
          href={`/u/${clip.handle}`}
          className="text-muted transition-colors hover:text-bone"
          style={viber ? { color: `hsl(${viber.hue} 55% 70%)` } : undefined}
        >
          @{clip.handle}
        </Link>
        <span aria-hidden>·</span>
        <span>{clip.runCode}</span>
        <span aria-hidden>·</span>
        <span>{compact(clip.views)} views</span>
      </p>
    </article>
  );
}
