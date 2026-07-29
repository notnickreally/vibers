"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DIAL_LENGTH, NOTCHES } from "@/lib/admin/locks";

/**
 * Layer three — the vectorscope.
 *
 * A scope with a graticule and a live trace, and a dial around it with twelve
 * notches. Turn to a notch, lock it, three times, in order. Twelve notches and
 * three positions is 1728 combinations — which is a puzzle and not a password,
 * and the reason this is the *third* layer rather than the only one. What makes
 * it cost anything is the lockout behind it.
 *
 * Turn it by dragging, by the arrow keys, or by clicking a notch. The whole
 * control is a `role="slider"`, so it announces which notch it is on rather
 * than being a picture you have to see to use.
 *
 * The trace is drawn on a canvas from `requestAnimationFrame`, which is the
 * only honest way to get a scope that moves like a scope. It never renders
 * during React's render pass, and under `prefers-reduced-motion` it draws one
 * still frame and stops — a rotating trace is exactly the kind of continuous
 * motion that block exists to switch off.
 */

const SIZE = 280;

/** The three lock positions, as values rather than indices — they never reorder. */
const PIPS = Array.from({ length: DIAL_LENGTH }, (_, index) => index);

export interface VectorscopeProps {
  onSubmit: (dial: number[]) => void;
  busy?: boolean;
  /** Bumped on a refusal. Collapses the trace and clears what was locked. */
  rejections?: number;
  /** Bumped on success. Opens the ring. */
  accepted?: number;
  mode?: "solve" | "set";
}

function notchAngle(notch: number): number {
  return -Math.PI / 2 + (notch / NOTCHES) * Math.PI * 2;
}

export function Vectorscope({
  onSubmit,
  busy = false,
  rejections = 0,
  accepted = 0,
  mode = "solve",
}: VectorscopeProps) {
  const [notch, setNotch] = useState(0);
  const [locked, setLocked] = useState<number[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [shake, setShake] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  // Read by the animation loop, which must not re-subscribe every time the
  // dial moves — a rAF loop that tears down and restarts on each state change
  // drops frames exactly when the thing is being used.
  const notchRef = useRef(0);
  const collapsedRef = useRef(false);

  notchRef.current = notch;
  collapsedRef.current = collapsed;

  useEffect(() => {
    if (rejections === 0) return;
    setShake((n) => n + 1);
    setCollapsed(true);
    setLocked([]);
    const timer = setTimeout(() => setCollapsed(false), 900);
    return () => clearTimeout(timer);
  }, [rejections]);

  /** The scope itself. One effect, mounted once, reading refs for live values. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * ratio;
    canvas.height = SIZE * ratio;
    context.scale(ratio, ratio);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const centre = SIZE / 2;
    const radius = SIZE / 2 - 26;
    let frame = 0;
    let start = 0;

    function graticule(ctx: CanvasRenderingContext2D) {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = "#0c0810";
      ctx.beginPath();
      ctx.arc(centre, centre, radius + 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#271b39";
      ctx.lineWidth = 1;
      for (const scale of [0.35, 0.65, 1]) {
        ctx.beginPath();
        ctx.arc(centre, centre, radius * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(centre - radius, centre);
      ctx.lineTo(centre + radius, centre);
      ctx.moveTo(centre, centre - radius);
      ctx.lineTo(centre, centre + radius);
      ctx.stroke();

      // Twelve marks, because there are twelve notches. The graticule is the
      // legend for the dial, not decoration on top of it.
      for (let i = 0; i < NOTCHES; i += 1) {
        const angle = notchAngle(i);
        const inner = radius - 8;
        ctx.strokeStyle = i === notchRef.current ? "#ffae3c" : "#33234a";
        ctx.lineWidth = i === notchRef.current ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(centre + Math.cos(angle) * inner, centre + Math.sin(angle) * inner);
        ctx.lineTo(centre + Math.cos(angle) * radius, centre + Math.sin(angle) * radius);
        ctx.stroke();
      }
    }

    function trace(ctx: CanvasRenderingContext2D, phase: number) {
      const flat = collapsedRef.current;
      const turn = notchAngle(notchRef.current) + Math.PI / 2;

      ctx.lineWidth = 1.6;
      // Three passes at falling opacity: a phosphor trail, which is what a
      // real scope leaves and what makes this read as a scope rather than a
      // spirograph.
      for (let pass = 0; pass < 3; pass += 1) {
        const lag = phase - pass * 0.16;
        ctx.strokeStyle = flat
          ? `rgba(109, 96, 132, ${0.5 - pass * 0.15})`
          : `rgba(53, 224, 206, ${0.75 - pass * 0.22})`;
        ctx.beginPath();
        for (let step = 0; step <= 180; step += 1) {
          const t = (step / 180) * Math.PI * 2;
          // Collapsed, the trace loses its vertical component and lies down —
          // a flat line is what a scope shows when there is no signal.
          const wobble = flat ? 0 : 0.18 * Math.sin(3 * t + lag) + 0.08 * Math.sin(5 * t - lag);
          const r = radius * (0.58 + wobble);
          const x = centre + Math.cos(t + turn) * r;
          const y = centre + Math.sin(t + turn) * r * (flat ? 0.02 : 1);
          if (step === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    function draw(now: number) {
      if (!start) start = now;
      graticule(context as CanvasRenderingContext2D);
      trace(context as CanvasRenderingContext2D, ((now - start) / 1000) * 1.4);
      if (!still) frame = requestAnimationFrame(draw);
    }

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  const notchFromPointer = useCallback((clientX: number, clientY: number) => {
    const box = ringRef.current?.getBoundingClientRect();
    if (!box) return null;
    const dx = clientX - (box.left + box.width / 2);
    const dy = clientY - (box.top + box.height / 2);
    if (Math.hypot(dx, dy) < 20) return null;
    const angle = Math.atan2(dy, dx) + Math.PI / 2;
    const turns = angle / (Math.PI * 2);
    return ((Math.round(turns * NOTCHES) % NOTCHES) + NOTCHES) % NOTCHES;
  }, []);

  const lock = useCallback(() => {
    if (busy) return;
    const next = [...locked, notch];
    setLocked(next);
    // The third notch is the answer — asking for a separate "submit" after it
    // would be a fourth thing to do and no extra information.
    if (next.length === DIAL_LENGTH) onSubmit(next);
  }, [busy, locked, notch, onSubmit]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (busy) return;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setNotch((n) => (n + 1) % NOTCHES);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setNotch((n) => (n - 1 + NOTCHES) % NOTCHES);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      lock();
    }
  };

  return (
    <div>
      <div key={shake} className={shake > 0 ? "gate-shake" : undefined}>
        <div className="flex justify-center">
          <div
            ref={ringRef}
            // A slider is what this is: one value, twelve stops, arrow keys.
            // No input type draws a dial, so the role carries the meaning.
            role="slider"
            tabIndex={busy ? -1 : 0}
            aria-label="Vectorscope dial"
            aria-valuemin={1}
            aria-valuemax={NOTCHES}
            aria-valuenow={notch + 1}
            aria-valuetext={`Notch ${notch + 1} of ${NOTCHES}, ${locked.length} of ${DIAL_LENGTH} locked`}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              if (busy) return;
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              const next = notchFromPointer(e.clientX, e.clientY);
              if (next !== null) setNotch(next);
            }}
            onPointerMove={(e) => {
              if (!dragging.current) return;
              const next = notchFromPointer(e.clientX, e.clientY);
              if (next !== null) setNotch(next);
            }}
            onPointerUp={() => {
              dragging.current = false;
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
            style={{ width: SIZE, height: SIZE }}
            className="relative max-w-full touch-none rounded-full border border-edge bg-ink-2 select-none"
          >
            <canvas
              ref={canvasRef}
              style={{ width: SIZE, height: SIZE }}
              className="absolute inset-0"
              aria-hidden
            />

            {/* The dial's handle, riding the notch. */}
            <div
              aria-hidden
              style={{
                left: `${50 + Math.cos(notchAngle(notch)) * 41}%`,
                top: `${50 + Math.sin(notchAngle(notch)) * 41}%`,
              }}
              className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber shadow-[0_0_10px_2px_rgba(255,174,60,0.45)] transition-[left,top] duration-150"
            />

            {accepted > 0 && (
              <div
                key={`burst-${accepted}`}
                aria-hidden
                className="scope-burst pointer-events-none absolute inset-2 rounded-full border-2 border-teal"
              />
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="eyebrow">Locked</span>
          <div className="flex gap-1.5">
            {PIPS.map((position) => (
              <span
                key={`pip-${position}`}
                className={`flex h-6 w-6 items-center justify-center border font-mono text-[11px] ${
                  position < locked.length
                    ? "border-teal bg-teal/12 text-teal"
                    : "border-edge text-faint"
                }`}
              >
                {position < locked.length ? locked[position] + 1 : "·"}
              </span>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          {locked.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setLocked([])}
              className="px-3 py-2 font-mono text-[11px] tracking-[0.12em] text-muted uppercase transition-colors hover:text-bone disabled:opacity-40"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            disabled={busy || locked.length >= DIAL_LENGTH}
            onClick={lock}
            className="bg-amber px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone disabled:cursor-not-allowed disabled:bg-edge disabled:text-faint"
          >
            {busy ? "Checking…" : `Lock ${notch + 1}`}
          </button>
        </div>
      </div>

      <p className="mt-3 font-mono text-[11px] text-faint">
        {mode === "set"
          ? "Three notches, in order. This one you have to remember."
          : "Drag the ring or use the arrow keys. Order matters."}
      </p>
    </div>
  );
}
