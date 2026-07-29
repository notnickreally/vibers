"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { LiveBadge } from "@/components/ui/bits";
import { compact } from "@/lib/format";
import type { Stream } from "@/lib/stream";

/**
 * The panel itself — the wall, with the moderation it has never had.
 *
 * The README's standing gap: the wall is shared but anonymous, so anyone can
 * put a stream up and anyone can take one down, and nothing records who did
 * which. This does not close that gap for the public routes — those are still
 * open, deliberately, because the wall is meant to be everybody's. What it adds
 * is a place where the same three actions happen behind a sign-in, so an
 * operator clearing up after a bad sourcing run is doing it as somebody.
 *
 * Every action here re-authorizes on the server. This component being on screen
 * proves nothing to `/api/admin/streams`, which checks the cookie itself.
 */

export interface Readout {
  name: string;
  set: boolean;
  why: string;
}

export interface PanelData {
  handle: string;
  streams: Stream[];
  dismissed: number;
  environment: Readout[];
  admins: { handle: string; createdAt: number }[];
}

/** Deterministic, and UTC — a locale-formatted date would differ across hydration. */
function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function Panel({ initial }: { initial: PanelData }) {
  const [streams, setStreams] = useState(initial.streams);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (label: string, init: RequestInit & { query?: string }, done: string) => {
      setBusy(label);
      setError(null);
      setNote(null);
      try {
        const response = await fetch(`/api/admin/streams${init.query ?? ""}`, init);
        const data = (await response.json().catch(() => ({}))) as {
          streams?: Stream[];
          error?: string;
        };
        if (!response.ok) {
          // A 401 here means the session went away underneath us — expired, or
          // a credential changed. Sending them back to the gate is the only
          // useful thing to do about it.
          if (response.status === 401) {
            window.location.assign("/admin/login");
            return;
          }
          setError(data.error ?? "That didn't work.");
          return;
        }
        if (data.streams) setStreams(data.streams);
        setNote(done);
      } catch {
        setError("Couldn't reach the server.");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const live = streams.filter((s) => s.isLive === true).length;
  const sourced = streams.filter((s) => s.sourcedAt !== undefined).length;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-edge-soft pb-4">
        <div>
          <p className="eyebrow">Signed in</p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-bone">
            {initial.handle}
          </h1>
        </div>
        <button
          type="button"
          onClick={async () => {
            await fetch("/api/admin/logout", { method: "POST" });
            window.location.assign("/");
          }}
          className="border border-edge px-3 py-2 font-mono text-[11px] tracking-[0.12em] text-muted uppercase transition-colors hover:border-del hover:text-del"
        >
          Sign out
        </button>
      </div>

      <section>
        <div className="grid grid-cols-2 gap-px border border-edge-soft bg-edge-soft sm:grid-cols-4">
          {[
            { label: "On the wall", value: String(streams.length) },
            { label: "Live now", value: String(live) },
            { label: "Auto-sourced", value: String(sourced) },
            { label: "Dismissed", value: String(initial.dismissed) },
          ].map((stat) => (
            <div key={stat.label} className="bg-ink p-4">
              <p className="eyebrow">{stat.label}</p>
              <p className="mt-1 font-mono text-2xl text-bone">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => act("refresh", { method: "POST" }, "Liveness re-asked.")}
            className="border border-edge px-3 py-2 font-mono text-[11px] tracking-[0.12em] text-bone uppercase transition-colors hover:border-teal hover:text-teal disabled:opacity-40"
          >
            {busy === "refresh" ? "Asking…" : "Re-ask liveness"}
          </button>
          <button
            type="button"
            disabled={busy !== null || sourced === 0}
            onClick={() =>
              act(
                "sourced",
                { method: "DELETE", query: "?sourced=1" },
                "Every sourced stream is off the wall.",
              )
            }
            className="border border-edge px-3 py-2 font-mono text-[11px] tracking-[0.12em] text-bone uppercase transition-colors hover:border-del hover:text-del disabled:opacity-40"
          >
            {busy === "sourced" ? "Clearing…" : `Clear sourced (${sourced})`}
          </button>
        </div>

        <div aria-live="polite" className="mt-3 min-h-[1.75rem]">
          {error && <p className="font-mono text-[12px] text-del">{error}</p>}
          {note && !error && <p className="font-mono text-[12px] text-teal">{note}</p>}
        </div>
      </section>

      <section>
        <p className="eyebrow">The wall</p>
        <p className="mt-1 mb-4 text-[15px] text-muted">
          Taking one off takes it off for everyone. That is what a shared wall means.
        </p>

        {streams.length === 0 ? (
          <p className="border border-edge-soft bg-panel p-6 font-mono text-[13px] text-faint">
            Nothing is up.
          </p>
        ) : (
          <ul className="space-y-px border border-edge-soft bg-edge-soft">
            {streams.map((stream) => (
              <li
                key={stream.videoId}
                className="flex items-center gap-4 bg-ink p-3 transition-colors hover:bg-panel"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/watch/${encodeURIComponent(stream.videoId)}`}
                      className="truncate text-sm text-bone transition-colors hover:text-amber"
                    >
                      {stream.title}
                    </Link>
                    {stream.isLive === true && <LiveBadge />}
                    {stream.sourcedAt !== undefined && (
                      <span className="border border-edge px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-faint">
                        SOURCED
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-faint">
                    {stream.channel} · {day(stream.addedAt)}
                    {stream.viewers !== undefined ? ` · ${compact(stream.viewers)} watching` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    act(
                      stream.videoId,
                      { method: "DELETE", query: `?v=${encodeURIComponent(stream.videoId)}` },
                      "Off the wall, for everyone.",
                    )
                  }
                  aria-label={`Take ${stream.title} off the wall`}
                  className="shrink-0 border border-edge px-2.5 py-1.5 font-mono text-[11px] text-muted transition-colors hover:border-del hover:text-del disabled:opacity-40"
                >
                  {busy === stream.videoId ? "…" : "✕"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-8 sm:grid-cols-2">
        <div>
          <p className="eyebrow">This deployment</p>
          <p className="mt-1 mb-4 text-[15px] text-muted">
            Set or not set. Values are read on the server and never sent here.
          </p>
          <ul className="space-y-px border border-edge-soft bg-edge-soft">
            {initial.environment.map((entry) => (
              <li key={entry.name} className="bg-ink p-3">
                <div className="flex items-center justify-between gap-3">
                  <code className="font-mono text-[12px] text-bone">{entry.name}</code>
                  <span
                    className={`font-mono text-[10px] tracking-[0.14em] uppercase ${
                      entry.set ? "text-teal" : "text-faint"
                    }`}
                  >
                    {entry.set ? "set" : "not set"}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-faint">{entry.why}</p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="eyebrow">Who can get in</p>
          <p className="mt-1 mb-4 text-[15px] text-muted">
            Handles and the day they signed up. Nothing else is stored in the clear.
          </p>
          <ul className="space-y-px border border-edge-soft bg-edge-soft">
            {initial.admins.map((admin) => (
              <li key={admin.handle} className="flex items-center justify-between bg-ink p-3">
                <code className="font-mono text-[12px] text-bone">{admin.handle}</code>
                <span className="font-mono text-[11px] text-faint">{day(admin.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
