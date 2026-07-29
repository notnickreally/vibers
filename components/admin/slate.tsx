"use client";

import { useId, useState } from "react";
import { MIN_PASSPHRASE } from "@/lib/admin/locks";

/**
 * Layer one — the slate.
 *
 * A handle and a passphrase, which is the only ordinary thing about this gate
 * and deliberately so: the two layers after it are low-entropy puzzles, and if
 * the first one were a puzzle too there would be nothing here worth calling a
 * password. This is the layer that carries the entropy. The clapperboard is
 * how it looks, not what it is.
 *
 * The arm sits open while you type and claps when the server says yes — so the
 * animation is a report of what happened, which is the only kind this site has.
 */

export interface SlateProps {
  onSubmit: (handle: string, passphrase: string) => void;
  busy?: boolean;
  /** Bumped on a refusal. Shakes the board. */
  rejections?: number;
  /** Set once the server has said yes; the arm comes down. */
  clapped?: boolean;
  mode?: "solve" | "set";
}

export function Slate({
  onSubmit,
  busy = false,
  rejections = 0,
  clapped = false,
  mode = "solve",
}: SlateProps) {
  const [handle, setHandle] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const handleId = useId();
  const passphraseId = useId();

  const ready = handle.trim().length >= 3 && passphrase.length >= MIN_PASSPHRASE;

  return (
    <form
      key={rejections}
      className={rejections > 0 ? "gate-shake" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && ready) onSubmit(handle.trim().toLowerCase(), passphrase);
      }}
    >
      <div className="relative border border-edge bg-ink-2 p-5">
        <svg viewBox="0 0 320 96" className="w-full" aria-hidden>
          <title>Clapperboard</title>
          {/* The board. Stripes are the slate's, not a decoration. */}
          <rect x="0" y="30" width="320" height="66" fill="#1d1429" stroke="#33234a" />
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <rect
              key={`board-${i}`}
              x={i * 46}
              y={30}
              width={23}
              height={10}
              fill={i % 2 === 0 ? "#33234a" : "#100b16"}
            />
          ))}
          <text
            x="16"
            y="70"
            fill="#6d6084"
            fontFamily="var(--font-mono)"
            fontSize="12"
            letterSpacing="0.22em"
          >
            ROLL · VIBERS.TV
          </text>
          <text
            x="16"
            y="88"
            fill={clapped ? "#35e0ce" : "#33234a"}
            fontFamily="var(--font-mono)"
            fontSize="12"
            letterSpacing="0.22em"
          >
            TAKE {clapped ? "2" : "1"}
          </text>

          {/* The arm. Hinged at the left, open until you are let in. */}
          <g className="slate-arm" data-clap={clapped ? "shut" : "open"}>
            <rect x="0" y="8" width="320" height="20" fill="#251a34" stroke="#33234a" />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <rect
                key={`arm-${i}`}
                x={i * 46}
                y={8}
                width={23}
                height={20}
                fill={i % 2 === 0 ? "#f2eae0" : "#251a34"}
                opacity={0.85}
              />
            ))}
          </g>
        </svg>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor={handleId} className="eyebrow block">
              Handle
            </label>
            <input
              id={handleId}
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy || clapped}
              placeholder="lowercase, digits, - and _"
              className="mt-2 w-full border border-edge bg-panel px-3 py-2.5 font-mono text-[13px] text-bone placeholder:text-faint focus:border-amber focus:outline-none disabled:opacity-60"
            />
          </div>

          <div>
            <label htmlFor={passphraseId} className="eyebrow block">
              Passphrase
            </label>
            <input
              id={passphraseId}
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete={mode === "set" ? "new-password" : "current-password"}
              disabled={busy || clapped}
              placeholder={`at least ${MIN_PASSPHRASE} characters`}
              className="mt-2 w-full border border-edge bg-panel px-3 py-2.5 font-mono text-[13px] text-bone placeholder:text-faint focus:border-amber focus:outline-none disabled:opacity-60"
            />
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={busy || clapped || !ready}
        className="mt-4 w-full bg-amber px-4 py-3 font-mono text-xs font-semibold tracking-[0.14em] text-ink uppercase transition-colors hover:bg-bone disabled:cursor-not-allowed disabled:bg-edge disabled:text-faint"
      >
        {clapped ? "Marked" : busy ? "Checking…" : mode === "set" ? "Set it" : "Mark it"}
      </button>
    </form>
  );
}
