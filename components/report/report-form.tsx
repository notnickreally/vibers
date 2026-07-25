"use client";

import { useState } from "react";
import Link from "next/link";
import { RIGHTS_CONTACT } from "@/lib/stream";

/**
 * The takedown path. A creator whose stream is on someone's wall needs a way to
 * say so and be believed — so this is short, asks only what a review needs, and
 * requires no account.
 */

const REASONS = [
  {
    key: "unauthorized",
    label: "I own this stream and don't want it here",
    detail: "It comes off the wall while the report is reviewed.",
  },
  {
    key: "misrepresented",
    label: "The page misrepresents me or my work",
    detail: "Wrong attribution, implied endorsement, or misleading framing.",
  },
  {
    key: "infringing",
    label: "The video itself infringes my copyright",
    detail: "Reported here and to YouTube, which hosts the video.",
  },
  { key: "other", label: "Something else", detail: "Tell us what's wrong below." },
] as const;

export function ReportForm({ videoId }: { videoId?: string }) {
  const [reason, setReason] = useState<string>(REASONS[0].key);
  const [email, setEmail] = useState("");
  const [details, setDetails] = useState("");
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="border border-add/40 bg-add/6 p-8">
        <span className="border border-add/50 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.16em] text-add uppercase">
          Report filed
        </span>
        <h2 className="mt-4 font-display text-2xl font-semibold text-bone">
          It comes off the wall while this is reviewed
        </h2>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Reports naming a specific video are actioned before they are judged. A person
          reads the report within one business day, and you get a decision at{" "}
          {email || "the address you gave"}.
        </p>
        <p className="mt-4 max-w-xl font-mono text-[11px] leading-relaxed text-faint">
          Prototype build — this form has no backend, so nothing was actually sent. For
          anything urgent, write to {RIGHTS_CONTACT}.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block bg-amber px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
        >
          Back to the wall
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSent(true);
      }}
      className="max-w-2xl space-y-8"
    >
      {videoId && (
        <div className="border border-edge-soft bg-panel p-4">
          <p className="eyebrow">Reporting</p>
          <p className="mt-2 font-mono text-[12px] break-all text-teal">
            youtube.com/watch?v={videoId}
          </p>
        </div>
      )}

      <fieldset>
        <legend className="eyebrow">What&apos;s wrong</legend>
        <div className="mt-3 space-y-px border border-edge-soft bg-edge-soft">
          {REASONS.map((r) => (
            <label
              key={r.key}
              className="flex cursor-pointer items-start gap-3 bg-ink p-4 transition-colors hover:bg-panel"
            >
              <input
                type="radio"
                name="reason"
                value={r.key}
                checked={reason === r.key}
                onChange={() => setReason(r.key)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-amber)]"
              />
              <span>
                <span className="block text-sm text-bone">{r.label}</span>
                <span className="mt-1 block font-mono text-[11px] text-faint">{r.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="email" className="eyebrow block">
          Where to reach you
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-3 w-full border border-edge bg-panel px-3 py-2.5 font-mono text-[13px] text-bone placeholder:text-faint focus:border-amber focus:outline-none"
        />
        <p className="mt-1.5 font-mono text-[10px] text-faint">
          Used to send the decision, and nothing else. No account needed.
        </p>
      </div>

      <div>
        <label htmlFor="details" className="eyebrow block">
          Anything else we should know
        </label>
        <textarea
          id="details"
          rows={4}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Optional. A link to the channel helps if you're the creator."
          className="mt-3 w-full resize-none border border-edge bg-panel px-3 py-2.5 text-sm leading-relaxed text-bone placeholder:text-faint focus:border-amber focus:outline-none"
        />
      </div>

      <button
        type="submit"
        className="w-full bg-tally px-4 py-3 font-mono text-xs font-semibold tracking-[0.14em] text-ink uppercase transition-colors hover:bg-bone sm:w-auto"
      >
        File the report
      </button>
    </form>
  );
}
