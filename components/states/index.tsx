import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The states every surface here shares. Errors say what broke and what to do
 * about it; empty screens are an invitation, not an apology. Neither speaks in
 * the first person.
 */

/** Loading — tiles matching the real monitor geometry, so nothing shifts. */
export function WallSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      role="status"
      className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
      aria-busy="true"
      aria-label="Loading streams"
    >
      {Array.from({ length: count }, (_, i) => `tile-${i}`).map((key) => (
        <div key={key} className="border border-edge-soft bg-panel">
          <div className="flex items-center gap-2 border-b border-edge-soft bg-ink-2 px-2.5 py-1.5">
            <div className="shimmer h-3.5 w-14" />
          </div>
          <div className="shimmer aspect-video" />
          <div className="space-y-2 p-3">
            <div className="shimmer h-3.5 w-full" />
            <div className="shimmer h-3.5 w-2/3" />
            <div className="shimmer h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Empty — always carries the next action. */
export function EmptyState({
  slate,
  title,
  body,
  action,
}: {
  slate: string;
  title: string;
  body: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center border border-dashed border-edge px-6 py-20 text-center">
      <span className="border border-edge px-2 py-0.5 font-mono text-[10px] tracking-[0.18em] text-faint uppercase">
        {slate}
      </span>
      <h3 className="mt-4 font-display text-xl font-semibold text-bone">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-6 bg-amber px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** Error — names the failure, offers the retry, never apologises. */
export function ErrorState({
  title,
  body,
  code,
  action,
}: {
  title: string;
  body: string;
  code: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-del/40 bg-del/6 p-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="border border-del/50 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.16em] text-del uppercase">
          Failed
        </span>
        <p className="font-mono text-[11px] text-faint">{code}</p>
      </div>
      <h3 className="mt-4 font-display text-xl font-semibold text-bone">{title}</h3>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
