import { timecode } from "@/lib/format";
import type { WireEvent } from "@/lib/mock/types";

const KIND: Record<WireEvent["kind"], { label: string; cls: string }> = {
  commit: { label: "commit", cls: "text-teal" },
  deploy: { label: "deploy", cls: "text-add" },
  "test-pass": { label: "tests", cls: "text-add" },
  "test-fail": { label: "tests", cls: "text-del" },
  revert: { label: "revert", cls: "text-del" },
};

/** Per-run wire: what actually landed in the repo, in order. */
export function WireFeed({ events }: { events: WireEvent[] }) {
  return (
    <ul className="divide-y divide-edge-soft">
      {[...events].reverse().map((e, i) => {
        const kind = KIND[e.kind];
        return (
          <li key={i} className="p-3">
            <p className="flex items-baseline gap-2 font-mono text-[10px]">
              <span className="text-faint tabular-nums">{timecode(e.t)}</span>
              <span className={`tracking-[0.12em] uppercase ${kind.cls}`}>{kind.label}</span>
              {(e.added > 0 || e.removed > 0) && (
                <span className="ml-auto tabular-nums">
                  <span className="text-add">+{e.added}</span>{" "}
                  <span className="text-del">−{e.removed}</span>
                </span>
              )}
            </p>
            <p className="mt-1 font-mono text-[12px] text-bone/90">{e.message}</p>
            <p className="font-mono text-[10px] text-faint">{e.file}</p>
          </li>
        );
      })}
    </ul>
  );
}
