"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Watchlist } from "@/components/admin/watchlist";
import { LiveBadge } from "@/components/ui/bits";
import { cycleNote, failedNote, RECHECK_LABEL, RECHECK_MS } from "@/lib/admin/recheck";
import { compact } from "@/lib/format";
import type { Stream } from "@/lib/stream";
import type { Watched } from "@/lib/watch";

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
 * It is also the only surface for the watchlist, which is not a moderation tool
 * but belongs here for the same reason: naming the channels the wall watches is
 * a standing decision about what everyone sees, so it is made by somebody.
 *
 * Every action here re-authorizes on the server. This component being on screen
 * proves nothing to `/api/admin/streams`, which checks the cookie itself.
 *
 * **It also keeps its own clock.** Both checks the panel can do were buttons,
 * which meant a panel left open showed whatever was true when it loaded — the
 * one thing a wall of live streams cannot afford. So the same two calls run
 * themselves every five minutes, in one cycle, and the page refreshes behind
 * them so the counts, the roster and the environment readout are as current as
 * the lists. The cycle has two triggers and one body: the timer, and adding a
 * watched username — because the answer to "is that channel on air" is
 * interesting *now*, not at the next boundary. A run restarts the clock, so the
 * two triggers cannot stack.
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
  watchlist: Watched[];
}

/** Deterministic, and UTC — a locale-formatted date would differ across hydration. */
function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface Leg {
  streams?: Stream[];
  watchlist?: Watched[];
  result?: { found?: number };
}

/**
 * One leg of the automatic cycle.
 *
 * Deliberately not `act` below: that one owns the busy state, which disables
 * every button on the panel. A check nobody asked for must not take the
 * controls away from the person who is here — it just updates what it can and
 * says so. `null` means "trust nothing after this".
 */
async function leg(path: string, method: string): Promise<Leg | null> {
  const response = await fetch(path, { method });
  // Same reading as everywhere else here: a 401 means the session went away
  // underneath us, and the gate is the only useful place to be.
  if (response.status === 401) {
    window.location.assign("/admin/login");
    return null;
  }
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as Leg | null;
}

export function Panel({ initial }: { initial: PanelData }) {
  const [streams, setStreams] = useState(initial.streams);
  const [watchlist, setWatchlist] = useState(initial.watchlist);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<string | null>(null);
  /** When the last cycle *finished*. The timer counts from here, not from mount. */
  const [ranAt, setRanAt] = useState<number | null>(null);
  const running = useRef(false);
  const router = useRouter();

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

  /**
   * The cycle. Sweep the watched channels, re-ask liveness for every URL on
   * the wall, refresh the page behind both.
   *
   * The order is the point. A sweep can put a stream up, so running it first
   * means the liveness pass behind it covers what was just added instead of
   * leaving it unconfirmed for five minutes. Neither call is new — they are
   * exactly what **Check now** and **Re-ask liveness** have always sent, which
   * is what keeps the automatic path and the manual one from disagreeing.
   */
  const recheck = useCallback(async () => {
    // Two triggers, one body. A cycle already in flight wins; the one that
    // arrives on top of it drops rather than doubling every request.
    if (running.current) return;
    running.current = true;
    setChecking(true);
    try {
      const sweep = await leg("/api/admin/watchlist", "PUT");
      if (!sweep) {
        setChecked(failedNote(Date.now()));
        return;
      }
      if (sweep.watchlist) setWatchlist(sweep.watchlist);
      if (sweep.streams) setStreams(sweep.streams);

      const pass = await leg("/api/admin/streams", "POST");
      if (!pass) {
        setChecked(failedNote(Date.now()));
        return;
      }
      const checkedStreams = pass.streams ?? sweep.streams ?? [];
      setStreams(checkedStreams);
      setChecked(
        cycleNote({
          urls: checkedStreams.length,
          found: sweep.result?.found ?? 0,
          at: Date.now(),
        }),
      );

      // The page itself, and not only the two lists it holds in state: the
      // counts below, the roster and the environment readout are rendered on
      // the server, so a refresh is the only thing that makes them as current
      // as everything this cycle just fetched.
      router.refresh();
    } catch {
      setChecked(failedNote(Date.now()));
    } finally {
      running.current = false;
      setChecking(false);
      setRanAt(Date.now());
    }
  }, [router]);

  // The clock. It counts from the end of the last cycle rather than from a
  // fixed drumbeat, which is what stops a run somebody triggered — by adding a
  // username — from being followed seconds later by the interval's own.
  useEffect(() => {
    const since = ranAt === null ? 0 : Date.now() - ranAt;
    const timer = window.setTimeout(
      () => {
        void recheck();
      },
      Math.max(0, RECHECK_MS - since),
    );
    return () => window.clearTimeout(timer);
  }, [recheck, ranAt]);

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

        {/* The only evidence the automatic cycle leaves. Without a line saying
            when it last ran, "it checks itself" is something you take on
            faith — and this panel's whole argument is against doing that. */}
        <p aria-live="polite" className="font-mono text-[11px] text-faint">
          {checking
            ? "Checking every URL now…"
            : checked
              ? `${checked} · again in ${RECHECK_LABEL}`
              : `Every URL here is re-checked every ${RECHECK_LABEL}, and adding a watched channel checks straight away.`}
        </p>
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

      {/* Its own routes and its own errors, but not its own copy of the list:
          the cycle above sweeps the watchlist too, and a section that kept a
          private copy would show a stale "last on air" every time it did.
          `onAdded` is the second trigger — a username going on is a question
          worth asking the platforms immediately. */}
      <Watchlist
        watchlist={watchlist}
        onWatchlist={setWatchlist}
        onStreams={setStreams}
        onAdded={recheck}
      />

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
