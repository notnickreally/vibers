"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DESTINATIONS, type Patch, PATCH_COUNT, SOURCES } from "@/lib/admin/locks";

/**
 * Layer two — the patch bay.
 *
 * Six sources, six destinations, three cables. Pull a cable out of a source and
 * drop it on a destination, or click one and then the other; both work, and so
 * does the keyboard, because a sign-in you can only pass with a mouse is a
 * sign-in some people cannot pass.
 *
 * The bay knows nothing. It collects three patches and posts them; whether they
 * are the right three is decided in `app/api/admin/login`, against a scrypt
 * digest this component has never seen. Everything here is presentation.
 *
 * The geometry is worth a note. The cables are SVG and the jacks are real HTML
 * buttons layered over them, which is the only arrangement that gets both a
 * bezier that sags and a control a screen reader can announce. That works
 * because the container's aspect ratio is pinned to the viewBox's — 360×300, so
 * `aspect-[6/5]` — which means `meet` fits exactly and a jack at viewBox x=54
 * is reliably at `left: 15%`.
 */

const VIEW = { w: 360, h: 300 };
const SOURCE_X = 56;
const DESTINATION_X = 304;
const FIRST_Y = 30;
const GAP = 48;

/**
 * Cable colours. Real patch cables are colour-coded and these are read the same
 * way — which cable is which. Tally red is not among them: on this site red
 * means one thing, and it is not "the third cable".
 */
const CABLE = ["#ffae3c", "#35e0ce", "#9b7bff", "#7fd4ff", "#f2eae0", "#e0a0ff"];

function jackY(index: number): number {
  return FIRST_Y + index * GAP;
}

/** A hanging cable. It sags with its span, because a cable with slack does. */
function cablePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const sag = 24 + Math.abs(dx) * 0.14;
  return `M ${x1} ${y1} C ${x1 + dx * 0.42} ${y1 + sag}, ${x2 - dx * 0.42} ${y2 + sag}, ${x2} ${y2}`;
}

export interface PatchBayProps {
  /** Called with three patches. The parent posts them; this never does. */
  onSubmit: (patches: Patch[]) => void;
  /** True while the answer is in flight. Disables everything. */
  busy?: boolean;
  /** Bumped by the parent on a refusal. Shakes the bay and drops the cables. */
  rejections?: number;
  /** "Patch three cables" reads differently when you are choosing them. */
  mode?: "solve" | "set";
}

export function PatchBay({ onSubmit, busy = false, rejections = 0, mode = "solve" }: PatchBayProps) {
  const [patches, setPatches] = useState<Patch[]>([]);
  const [armed, setArmed] = useState<number | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [shake, setShake] = useState(0);
  const [seated, setSeated] = useState<number | null>(null);

  const frameRef = useRef<HTMLDivElement>(null);
  const swallowClick = useRef(false);
  const movedFrom = useRef<{ x: number; y: number } | null>(null);
  const gradientId = useId();

  // A refusal empties the bay. The cables fall out first, then the state
  // clears — otherwise they vanish rather than drop, which reads as a bug.
  useEffect(() => {
    if (rejections === 0) return;
    setShake((n) => n + 1);
    setDropping(true);
    setArmed(null);
    const timer = setTimeout(() => {
      setPatches([]);
      setDropping(false);
    }, 420);
    return () => clearTimeout(timer);
  }, [rejections]);

  const used = {
    sources: new Set(patches.map((p) => p.source)),
    destinations: new Set(patches.map((p) => p.destination)),
  };

  const connect = useCallback(
    (source: number, destination: number) => {
      setPatches((current) => {
        if (current.length >= PATCH_COUNT) return current;
        if (current.some((p) => p.source === source || p.destination === destination)) {
          return current;
        }
        return [...current, { source, destination }];
      });
      setSeated(destination);
      setArmed(null);
      setPointer(null);
    },
    [],
  );

  /** Pulling a cable back out. The jack it freed is patchable again. */
  const unpatch = useCallback((source: number) => {
    setPatches((current) => current.filter((p) => p.source !== source));
  }, []);

  const toViewBox = useCallback((clientX: number, clientY: number) => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return {
      x: ((clientX - box.left) / box.width) * VIEW.w,
      y: ((clientY - box.top) / box.height) * VIEW.h,
    };
  }, []);

  const startDrag = (source: number, clientX: number, clientY: number) => {
    if (busy || used.sources.has(source) || patches.length >= PATCH_COUNT) return;
    setArmed(source);
    movedFrom.current = { x: clientX, y: clientY };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (armed === null) return;
    const point = toViewBox(event.clientX, event.clientY);
    if (point) setPointer(point);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (armed === null) return;
    const from = movedFrom.current;
    const travelled = from
      ? Math.hypot(event.clientX - from.x, event.clientY - from.y)
      : 0;
    setPointer(null);
    movedFrom.current = null;

    // Under ten pixels is a click, not a drag: the cable stays in hand and the
    // next click on a destination lands it. That is the keyboard path too.
    if (travelled < 10) return;

    const point = toViewBox(event.clientX, event.clientY);
    if (!point) {
      setArmed(null);
      return;
    }
    let nearest = -1;
    let best = Number.POSITIVE_INFINITY;
    DESTINATIONS.forEach((_, index) => {
      if (used.destinations.has(index)) return;
      const distance = Math.hypot(point.x - DESTINATION_X, point.y - jackY(index));
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    });
    if (nearest >= 0 && best < 34) {
      connect(armed, nearest);
      swallowClick.current = true;
    } else {
      setArmed(null);
    }
  };

  const complete = patches.length === PATCH_COUNT;

  return (
    <div>
      <div
        key={shake}
        className={shake > 0 ? "gate-shake" : undefined}
        // The frame is the coordinate space both layers agree on. 6/5 matches
        // the viewBox exactly, so the SVG never letterboxes and the buttons
        // never drift off their jacks.
      >
        <div
          ref={frameRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setPointer(null)}
          className="relative aspect-[6/5] w-full touch-none border border-edge bg-ink-2 select-none"
        >
          <svg
            viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            <title>Patch bay</title>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#251a34" />
                <stop offset="100%" stopColor="#17101f" />
              </linearGradient>
            </defs>
            <rect width={VIEW.w} height={VIEW.h} fill={`url(#${gradientId})`} />

            {/* The rack strip behind each column of jacks. */}
            <rect x={SOURCE_X - 26} y={12} width={52} height={VIEW.h - 24} fill="#1d1429" />
            <rect x={DESTINATION_X - 26} y={12} width={52} height={VIEW.h - 24} fill="#1d1429" />

            {SOURCES.map((label, index) => (
              <g key={label}>
                <circle cx={SOURCE_X} cy={jackY(index)} r={11} fill="#100b16" stroke="#33234a" />
                <circle cx={SOURCE_X} cy={jackY(index)} r={4} fill="#33234a" />
                <text
                  x={SOURCE_X + 24}
                  y={jackY(index) + 4}
                  fill={used.sources.has(index) ? "#f2eae0" : "#6d6084"}
                  fontFamily="var(--font-mono)"
                  fontSize="11"
                  letterSpacing="0.08em"
                >
                  {label}
                </text>
              </g>
            ))}

            {DESTINATIONS.map((label, index) => (
              <g key={label}>
                <circle
                  cx={DESTINATION_X}
                  cy={jackY(index)}
                  r={11}
                  fill="#100b16"
                  stroke="#33234a"
                />
                <circle cx={DESTINATION_X} cy={jackY(index)} r={4} fill="#33234a" />
                <text
                  x={DESTINATION_X - 24}
                  y={jackY(index) + 4}
                  textAnchor="end"
                  fill={used.destinations.has(index) ? "#f2eae0" : "#6d6084"}
                  fontFamily="var(--font-mono)"
                  fontSize="11"
                  letterSpacing="0.08em"
                >
                  {label}
                </text>
              </g>
            ))}

            {/* The cable in hand, following the pointer. No sag worth speaking
                of — it is taut because you are pulling it. */}
            {armed !== null && pointer && (
              <path
                d={cablePath(SOURCE_X, jackY(armed), pointer.x, pointer.y)}
                stroke={CABLE[armed]}
                strokeWidth={3}
                strokeLinecap="round"
                fill="none"
                opacity={0.75}
              />
            )}

            <g className={dropping ? "cable-drop" : undefined}>
              {patches.map((patch) => (
                <g key={`${patch.source}-${patch.destination}`}>
                  <path
                    className="cable-draw"
                    d={cablePath(
                      SOURCE_X,
                      jackY(patch.source),
                      DESTINATION_X,
                      jackY(patch.destination),
                    )}
                    stroke={CABLE[patch.source]}
                    strokeWidth={3.5}
                    strokeLinecap="round"
                    fill="none"
                  />
                  <circle cx={SOURCE_X} cy={jackY(patch.source)} r={5} fill={CABLE[patch.source]} />
                  <circle
                    cx={DESTINATION_X}
                    cy={jackY(patch.destination)}
                    r={5}
                    fill={CABLE[patch.source]}
                  />
                </g>
              ))}
            </g>

            {/* The ring that leaves a jack the instant a plug seats in it. */}
            {seated !== null && (
              <circle
                key={`ping-${seated}-${patches.length}`}
                className="jack-ping"
                cx={DESTINATION_X}
                cy={jackY(seated)}
                r={11}
                fill="none"
                stroke="#35e0ce"
                strokeWidth={2}
              />
            )}
          </svg>

          {/* The real controls, over the drawing. */}
          {SOURCES.map((label, index) => {
            const patched = used.sources.has(index);
            return (
              <button
                key={label}
                type="button"
                disabled={busy || (!patched && patches.length >= PATCH_COUNT)}
                onPointerDown={(e) => {
                  if (patched) return;
                  startDrag(index, e.clientX, e.clientY);
                }}
                onClick={() => {
                  if (swallowClick.current) {
                    swallowClick.current = false;
                    return;
                  }
                  if (busy) return;
                  if (patched) unpatch(index);
                  else if (armed === index) setArmed(null);
                  else if (patches.length < PATCH_COUNT) setArmed(index);
                }}
                aria-pressed={armed === index}
                aria-label={
                  patched
                    ? `Unpatch ${label}`
                    : armed === index
                      ? `${label} cable in hand — now choose a destination`
                      : `Take the ${label} cable`
                }
                style={{
                  left: `${(SOURCE_X / VIEW.w) * 100}%`,
                  top: `${(jackY(index) / VIEW.h) * 100}%`,
                  borderColor: armed === index ? "#ffae3c" : "transparent",
                }}
                className="absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-colors hover:border-teal disabled:cursor-not-allowed"
              />
            );
          })}

          {DESTINATIONS.map((label, index) => {
            const patched = used.destinations.has(index);
            return (
              <button
                key={label}
                type="button"
                disabled={busy || patched || armed === null}
                onClick={() => {
                  if (swallowClick.current) {
                    swallowClick.current = false;
                    return;
                  }
                  if (armed !== null) connect(armed, index);
                }}
                aria-label={
                  patched ? `${label} is patched` : `Patch the cable in hand into ${label}`
                }
                style={{
                  left: `${(DESTINATION_X / VIEW.w) * 100}%`,
                  top: `${(jackY(index) / VIEW.h) * 100}%`,
                  borderColor: armed !== null && !patched ? "#35e0ce" : "transparent",
                }}
                className="absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-colors hover:border-teal disabled:cursor-not-allowed"
              />
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11px] text-faint">
          {complete
            ? `${PATCH_COUNT} of ${PATCH_COUNT} patched — order doesn't matter.`
            : armed !== null
              ? `${SOURCES[armed]} in hand. Drop it on a destination.`
              : mode === "set"
                ? `Choose ${PATCH_COUNT} cables. Remember them.`
                : `Patch ${PATCH_COUNT - patches.length} more.`}
        </p>
        <div className="flex gap-2">
          {patches.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPatches([]);
                setArmed(null);
              }}
              className="px-3 py-2 font-mono text-[11px] tracking-[0.12em] text-muted uppercase transition-colors hover:text-bone disabled:opacity-40"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            disabled={busy || !complete}
            onClick={() => onSubmit(patches)}
            className="bg-amber px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone disabled:cursor-not-allowed disabled:bg-edge disabled:text-faint"
          >
            {busy ? "Checking…" : mode === "set" ? "Use this patch" : "Take"}
          </button>
        </div>
      </div>
    </div>
  );
}
