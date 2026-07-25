import Link from "next/link";
import { signed } from "@/lib/format";

/**
 * The Wire — the site's signature strip. Every deploy, revert and passing suite
 * across the network scrolls here, continuously. It is the one piece of chrome
 * that is never quiet, because on vibers.tv something is always mid-change.
 */
const WIRE_ITEMS: {
  handle: string;
  verb: string;
  detail: string;
  tone: "add" | "del" | "amber" | "teal";
}[] = [
  { handle: "tinystack", verb: "shipped", detail: "split-the-bill → production", tone: "add" },
  { handle: "nocturne", verb: "reverted", detail: "invented error type, again", tone: "del" },
  { handle: "prompt_gremlin", verb: "one-shot", detail: "412 lines, 0 follow-ups", tone: "amber" },
  { handle: "segfaultsammy", verb: "suite green", detail: "after 137 prompts", tone: "add" },
  { handle: "hexwitch", verb: "committed", detail: "fog.wgsl " + signed(88) + " / -41", tone: "teal" },
  { handle: "solidgold", verb: "co-prompt adopted", detail: "on RUN-4821", tone: "amber" },
  { handle: "kernelpanik", verb: "deployed", detail: "jam build 61", tone: "add" },
  { handle: "swiftlyanne", verb: "rewrote", detail: "the animation curve, 9th time", tone: "teal" },
  { handle: "ghostwrite", verb: "abandoned", detail: "the migration, 5h39m", tone: "del" },
  { handle: "mainthread", verb: "p99", detail: "41ms → 38ms", tone: "add" },
];

const TONE_CLASS = {
  add: "text-add",
  del: "text-del",
  amber: "text-amber",
  teal: "text-teal",
} as const;

export function ShipTicker() {
  const stream = [...WIRE_ITEMS, ...WIRE_ITEMS];
  return (
    <div className="relative overflow-hidden border-b border-edge-soft bg-ink-2">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-ink-2 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-ink-2 to-transparent" />
      <div className="flex items-center">
        <span className="z-20 shrink-0 border-r border-edge-soft bg-panel px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.18em] text-amber uppercase">
          The Wire
        </span>
        <div className="flex overflow-hidden">
          {/* Two identical copies: translating exactly -50% keeps the loop seamless. */}
          <div className="wire-marquee flex shrink-0 items-center whitespace-nowrap py-1.5">
            {stream.map((item, i) => (
              <span key={i} className="flex items-center font-mono text-[11px]">
                <Link
                  href={`/u/${item.handle}`}
                  className="text-muted transition-colors hover:text-bone"
                >
                  @{item.handle}
                </Link>
                <span className={`ml-1.5 ${TONE_CLASS[item.tone]}`}>{item.verb}</span>
                <span className="ml-1.5 text-faint">{item.detail}</span>
                <span aria-hidden className="mx-4 text-edge">
                  ◆
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
