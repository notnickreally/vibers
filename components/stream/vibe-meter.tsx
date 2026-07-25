"use client";

import { useState } from "react";
import { vibeLabel, vibeTone } from "@/lib/format";

/**
 * The audience read. Five options, no thumbs-down — "cooked" is not a insult
 * here, it is the reason a lot of people tuned in.
 */
const OPTIONS: { key: string; label: string; value: number }[] = [
  { key: "locked", label: "locked in", value: 92 },
  { key: "cooking", label: "cooking", value: 74 },
  { key: "grinding", label: "grinding", value: 54 },
  { key: "weeds", label: "in the weeds", value: 36 },
  { key: "cooked", label: "cooked", value: 14 },
];

export function VibeMeter({ initial }: { initial: number }) {
  const [vibe, setVibe] = useState(initial);
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">Vibe meter</p>
        <p className={`font-mono text-xs ${vibeTone(vibe)}`}>{vibeLabel(vibe)}</p>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden bg-ink" role="img" aria-label={`Audience read: ${vibeLabel(vibe)}, ${vibe} out of 100`}>
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${vibe}%`,
            background:
              vibe >= 65
                ? "var(--color-add)"
                : vibe >= 45
                  ? "var(--color-amber)"
                  : "var(--color-del)",
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => {
              setPicked(o.key);
              // Your vote nudges the room, it doesn't replace it.
              setVibe((v) => Math.round(v * 0.82 + o.value * 0.18));
            }}
            aria-pressed={picked === o.key}
            className={`border px-2 py-1 font-mono text-[10px] tracking-[0.08em] transition-colors ${
              picked === o.key
                ? "border-amber bg-amber/12 text-amber"
                : "border-edge text-muted hover:border-bone hover:text-bone"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] text-faint">
        {picked ? "Your read is in. It counts for 60s." : "1,204 reads in the last 5 minutes"}
      </p>
    </div>
  );
}
