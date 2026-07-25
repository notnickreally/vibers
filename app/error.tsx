"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
      <div className="border border-del/40 bg-del/6 p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="border border-del/50 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.16em] text-del uppercase">
            Failed
          </span>
          <p className="font-mono text-[11px] text-faint">
            {error.digest ? `digest/${error.digest}` : "client/unhandled"}
          </p>
        </div>
        <h1 className="mt-4 font-display text-2xl font-semibold text-bone">
          This page stopped rendering
        </h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
          Something threw while building the view. Reloading the page usually clears it — if
          it doesn&apos;t, the streams themselves are unaffected.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="bg-amber px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
          >
            Try again
          </button>
          <Link
            href="/"
            className="border border-edge px-4 py-2 font-mono text-[11px] tracking-[0.12em] text-bone uppercase transition-colors hover:border-teal hover:text-teal"
          >
            Back to the wall
          </Link>
        </div>
      </div>
    </div>
  );
}
