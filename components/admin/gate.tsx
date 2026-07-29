"use client";

import { useCallback, useState } from "react";
import type { Patch } from "@/lib/admin/locks";
import { PatchBay } from "./patch-bay";
import { Slate } from "./slate";
import { Vectorscope } from "./vectorscope";

/**
 * The gate, from the browser's side. Three layers, one at a time.
 *
 * This component's only real job is to post an answer and believe the reply.
 * It holds no secrets and can decide nothing: it does not know the patch set,
 * it does not know the combination, and advancing to layer two happens because
 * `app/api/admin/login` set a signed cookie saying so — not because this state
 * machine moved a number. Editing `layer` in the React devtools gets you a
 * different drawing and a 401.
 *
 * Each layer is unmounted when it is done, which is what makes the reveal
 * animation fire once and stay fired.
 */

const LAYERS = [
  { n: 1, slate: "Layer 01", name: "The Slate", hint: "Who's rolling." },
  { n: 2, slate: "Layer 02", name: "The Patch Bay", hint: "Three cables. Any order." },
  { n: 3, slate: "Layer 03", name: "The Vectorscope", hint: "Three notches. In order." },
] as const;

interface Refused {
  message: string;
  retryAfter?: number;
}

export function Gate() {
  const [layer, setLayer] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Refused | null>(null);
  const [rejections, setRejections] = useState(0);
  const [clapped, setClapped] = useState(false);
  const [accepted, setAccepted] = useState(0);

  /**
   * Post one layer's answer.
   *
   * Every failure is treated the same by design — the server gives one message
   * for a wrong passphrase, a wrong patch set, an expired stage cookie and a
   * missing one, so there is nothing here to tell apart.
   */
  const attempt = useCallback(async (payload: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        retryAfter?: number;
      };
      if (!response.ok) {
        setError({ message: data.error ?? "That didn't open.", retryAfter: data.retryAfter });
        setRejections((n) => n + 1);
        return false;
      }
      return true;
    } catch {
      setError({ message: "Couldn't reach the gate. Check the connection." });
      setRejections((n) => n + 1);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const onSlate = useCallback(
    async (handle: string, passphrase: string) => {
      if (await attempt({ layer: 1, handle, passphrase })) {
        setClapped(true);
        // Long enough for the arm to come down. The layer swap waits on the
        // animation rather than racing it.
        setTimeout(() => setLayer(2), 620);
      }
    },
    [attempt],
  );

  const onPatch = useCallback(
    async (patches: Patch[]) => {
      if (await attempt({ layer: 2, patches })) setLayer(3);
    },
    [attempt],
  );

  const onDial = useCallback(
    async (dial: number[]) => {
      if (await attempt({ layer: 3, dial })) {
        setAccepted((n) => n + 1);
        // A full page load rather than a client navigation: the session cookie
        // was just set, and the panel is server-rendered behind it.
        setTimeout(() => {
          window.location.assign("/admin");
        }, 700);
      }
    },
    [attempt],
  );

  const current = LAYERS[layer - 1];

  return (
    <div className="mx-auto w-full max-w-lg">
      {/* Three lamps, one per layer. Amber for where you are, teal for done —
          never tally red, which on this site means one stream is live. */}
      <div className="mb-6 flex items-center gap-2">
        {LAYERS.map((step) => (
          <div key={step.n} className="flex-1">
            <div
              className={`h-1 transition-colors duration-300 ${
                step.n < layer ? "bg-teal" : step.n === layer ? "bg-amber" : "bg-edge"
              }`}
            />
            <p
              className={`mt-2 font-mono text-[10px] tracking-[0.14em] uppercase ${
                step.n === layer ? "text-bone" : step.n < layer ? "text-teal" : "text-faint"
              }`}
            >
              {step.slate}
            </p>
          </div>
        ))}
      </div>

      <div key={layer} className="gate-step">
        <p className="eyebrow">{current.hint}</p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-bone">{current.name}</h1>

        <div className="mt-6">
          {layer === 1 && (
            <Slate onSubmit={onSlate} busy={busy} rejections={rejections} clapped={clapped} />
          )}
          {layer === 2 && <PatchBay onSubmit={onPatch} busy={busy} rejections={rejections} />}
          {layer === 3 && (
            <Vectorscope
              onSubmit={onDial}
              busy={busy}
              rejections={rejections}
              accepted={accepted}
            />
          )}
        </div>
      </div>

      <div aria-live="polite" className="mt-5 min-h-[2.5rem]">
        {error && (
          <p className="border border-del/40 bg-del/8 px-3 py-2 font-mono text-[12px] text-del">
            {error.message}
          </p>
        )}
        {accepted > 0 && !error && (
          <p className="border border-teal/40 bg-teal/8 px-3 py-2 font-mono text-[12px] text-teal">
            All three. Opening the panel…
          </p>
        )}
      </div>
    </div>
  );
}
