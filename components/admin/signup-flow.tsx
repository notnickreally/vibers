"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import type { Patch } from "@/lib/admin/locks";
import { PatchBay } from "./patch-bay";
import { Slate } from "./slate";
import { Vectorscope } from "./vectorscope";

/**
 * Signing up: the same three layers, run backwards.
 *
 * You choose the patch set and the combination here rather than guessing them,
 * on the same two controls you will later be asked to repeat them on — which is
 * the point. A puzzle you set on a different widget than the one you solve is a
 * puzzle you will not remember.
 *
 * Nothing is sent until the last notch is locked, and then all four secrets go
 * in one request. Signing up does not sign you in: the account exists, and the
 * gate is still the gate.
 */

type Step = "key" | "slate" | "patch" | "dial" | "done";

export function SignupFlow() {
  const [step, setStep] = useState<Step>("key");
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [patches, setPatches] = useState<Patch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejections, setRejections] = useState(0);
  const [seats, setSeats] = useState<number | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const passwordId = useId();

  // How many seats are left, so a full deployment says so before anyone fills
  // three screens in. A 503 here means the signup password is unset.
  useEffect(() => {
    let live = true;
    fetch("/api/admin/signup")
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          seats?: number;
          error?: string;
        };
        if (!live) return;
        if (!response.ok) setClosed(data.error ?? "Signing up is closed here.");
        else setSeats(data.seats ?? null);
      })
      .catch(() => {
        if (live) setClosed("Couldn't reach the server.");
      });
    return () => {
      live = false;
    };
  }, []);

  const submit = useCallback(
    async (dial: number[]) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/admin/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password, handle, passphrase, patches, dial }),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Couldn't create that account.");
          setRejections((n) => n + 1);
          // Back to the first screen, keeping everything already chosen — the
          // usual failure here is a mistyped signup password, and making
          // someone redo two puzzles over a typo is a punishment, not a gate.
          setStep("key");
          return;
        }
        setStep("done");
      } catch {
        setError("Couldn't reach the server.");
        setRejections((n) => n + 1);
        setStep("key");
      } finally {
        setBusy(false);
      }
    },
    [password, handle, passphrase, patches],
  );

  if (closed) {
    return (
      <div className="mx-auto w-full max-w-lg border border-del/40 bg-del/6 p-6">
        <p className="eyebrow">Closed</p>
        <p className="mt-2 font-mono text-[13px] leading-relaxed text-bone">{closed}</p>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="mx-auto w-full max-w-lg gate-step border border-teal/40 bg-teal/6 p-6">
        <span className="border border-teal/50 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.16em] text-teal uppercase">
          Account made
        </span>
        <h2 className="mt-4 font-display text-2xl font-semibold text-bone">
          Now do it again, for real
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          <span className="font-mono text-teal">{handle}</span> exists. Signing up doesn&apos;t sign
          you in — walk the three layers to get into the panel.
        </p>
        <Link
          href="/admin/login"
          className="mt-6 inline-block bg-amber px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
        >
          Go to the gate
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      {seats !== null && (
        <p className="eyebrow mb-5">
          {seats === 0 ? "No seats left" : `${seats} seat${seats === 1 ? "" : "s"} left`}
        </p>
      )}

      <div key={step} className="gate-step">
        {step === "key" && (
          <form
            key={rejections}
            className={rejections > 0 ? "gate-shake" : undefined}
            onSubmit={(event) => {
              event.preventDefault();
              if (password.length > 0) setStep("slate");
            }}
          >
            <p className="eyebrow">Step 01</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-bone">The signup key</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              The password this deployment holds. Not your passphrase — the one that says you are
              allowed to make an account at all.
            </p>
            <label htmlFor={passwordId} className="eyebrow mt-6 block">
              Signup password
            </label>
            <input
              id={passwordId}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              className="mt-2 w-full border border-edge bg-panel px-3 py-2.5 font-mono text-[13px] text-bone placeholder:text-faint focus:border-amber focus:outline-none"
            />
            <button
              type="submit"
              disabled={password.length === 0}
              className="mt-5 w-full bg-amber px-4 py-3 font-mono text-xs font-semibold tracking-[0.14em] text-ink uppercase transition-colors hover:bg-bone disabled:cursor-not-allowed disabled:bg-edge disabled:text-faint"
            >
              Continue
            </button>
          </form>
        )}

        {step === "slate" && (
          <>
            <p className="eyebrow">Step 02</p>
            <h2 className="mt-1 mb-6 font-display text-2xl font-semibold text-bone">
              Handle and passphrase
            </h2>
            <Slate
              mode="set"
              onSubmit={(nextHandle, nextPassphrase) => {
                setHandle(nextHandle);
                setPassphrase(nextPassphrase);
                setStep("patch");
              }}
            />
          </>
        )}

        {step === "patch" && (
          <>
            <p className="eyebrow">Step 03</p>
            <h2 className="mt-1 mb-6 font-display text-2xl font-semibold text-bone">
              Choose your patch
            </h2>
            <PatchBay
              mode="set"
              onSubmit={(next) => {
                setPatches(next);
                setStep("dial");
              }}
            />
          </>
        )}

        {step === "dial" && (
          <>
            <p className="eyebrow">Step 04</p>
            <h2 className="mt-1 mb-6 font-display text-2xl font-semibold text-bone">
              Choose your combination
            </h2>
            <Vectorscope mode="set" busy={busy} onSubmit={submit} />
          </>
        )}
      </div>

      <div aria-live="polite" className="mt-5 min-h-[2.5rem]">
        {error && (
          <p className="border border-del/40 bg-del/8 px-3 py-2 font-mono text-[12px] text-del">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
