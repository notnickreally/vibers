import Link from "next/link";
import { compact, timecode } from "@/lib/format";
import type { PromptEvent } from "@/lib/mock/types";

/**
 * The full prompt transcript for a run, newest last. Timecodes are the
 * structural device throughout the site — they carry real information (when in
 * the run this happened) rather than decorating the list with numbers.
 */
const OUTCOME: Record<PromptEvent["outcome"], { label: string; cls: string }> = {
  shipped: { label: "committed", cls: "border-add/40 bg-add/10 text-add" },
  reverted: { label: "reverted", cls: "border-del/40 bg-del/10 text-del" },
  "rabbit-hole": { label: "rabbit hole", cls: "border-del/40 bg-del/10 text-del" },
  running: { label: "in flight", cls: "border-amber/40 bg-amber/10 text-amber" },
  clean: { label: "read only", cls: "border-edge text-faint" },
};

export function PromptCamTimeline({ prompts }: { prompts: PromptEvent[] }) {
  return (
    <ol className="divide-y divide-edge-soft border border-edge-soft">
      {prompts.map((p, i) => {
        const outcome = OUTCOME[p.outcome];
        return (
          <li key={i} className="grid gap-3 p-4 sm:grid-cols-[5.5rem_1fr_auto]">
            <p className="font-mono text-[11px] text-faint tabular-nums">{timecode(p.t)}</p>
            <div className="min-w-0">
              <p className="font-mono text-[13px] leading-relaxed text-bone/90">
                <span className="mr-1.5 text-amber">›</span>
                {p.text}
              </p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 font-mono text-[10px] text-faint">
                <span>{compact(p.tokens)} tokens</span>
                {p.adoptedFrom && (
                  <span className="text-teal">
                    co-prompt adopted from{" "}
                    <Link href={`/u/${p.adoptedFrom}`} className="underline hover:text-bone">
                      @{p.adoptedFrom}
                    </Link>
                  </span>
                )}
              </p>
            </div>
            <span
              className={`h-fit justify-self-start border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.12em] uppercase sm:justify-self-end ${outcome.cls}`}
            >
              {outcome.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
