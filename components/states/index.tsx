import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Every list surface on vibers.tv shares these five states. Errors say what
 * broke and what to do about it; empty screens are an invitation, not an
 * apology. Neither speaks in the first person.
 */

/** Loading — a grid of run-card skeletons that match the real card's geometry. */
export function RunGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      aria-busy="true"
      aria-label="Loading runs"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <div className="shimmer aspect-[16/10] border border-edge-soft" />
          <div className="mt-3 flex gap-3">
            <div className="shimmer h-[34px] w-[34px] shrink-0 rounded-[3px]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="shimmer h-3 w-24" />
              <div className="shimmer h-3 w-36" />
              <div className="shimmer h-3 w-20" />
            </div>
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

/**
 * Partial / slow — results are on screen but the set is incomplete. The banner
 * says which part is late, so a half-loaded page never reads as a full one.
 */
export function PartialBanner({ detail }: { detail: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 border border-amber/40 bg-amber/8 px-4 py-3">
      <span
        className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber"
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-sm text-bone/90">{detail}</p>
      <span className="font-mono text-[10px] tracking-[0.14em] text-amber uppercase">
        Partial results
      </span>
    </div>
  );
}
