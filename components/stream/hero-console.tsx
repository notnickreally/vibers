"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LiveBadge } from "@/components/ui/bits";
import { compact, timecode } from "@/lib/format";

/**
 * The signature surface: the loop itself. A prompt goes in on the left, a diff
 * lands on the right, and the run either ships or it doesn't. Everything else
 * on vibers.tv is scaffolding around this rectangle.
 *
 * It renders its first beat statically, then continues forward after mount —
 * so there is no hydration flash and no-JS visitors still see a real frame.
 */

type Beat = {
  prompt: string;
  lines: { sign: "+" | "-" | " "; text: string }[];
  file: string;
  verdict: { label: string; tone: "add" | "del" | "amber" };
};

const BEATS: Beat[] = [
  {
    prompt:
      "replace the ORM call in fetch_session with a hand-written prepared statement, keep the return type identical",
    file: "db/queries/session.rs",
    lines: [
      { sign: "-", text: "let row = Session::table()" },
      { sign: "-", text: "    .filter(id.eq(session_id))" },
      { sign: "-", text: "    .first::<Session>(conn)?;" },
      { sign: "+", text: "let row = sqlx::query_as!(" },
      { sign: "+", text: "    Session," },
      { sign: "+", text: '    "select * from sessions where id = $1",' },
      { sign: "+", text: "    session_id" },
      { sign: "+", text: ").fetch_one(conn).await?;" },
    ],
    verdict: { label: "14 tests passed · committed", tone: "add" },
  },
  {
    prompt: "now do the same for fetch_run_events. do NOT invent a new error type, reuse DbError",
    file: "db/queries/events.rs",
    lines: [
      { sign: "+", text: "#[derive(Debug, thiserror::Error)]" },
      { sign: "+", text: "pub enum QueryError {" },
      { sign: "+", text: "    #[error(\"row not found\")]" },
      { sign: "+", text: "    NotFound," },
      { sign: "+", text: "}" },
      { sign: " ", text: "" },
      { sign: " ", text: "// 2 failed — unknown variant DbError::Query" },
    ],
    verdict: { label: "it invented an error type · reverted", tone: "del" },
  },
  {
    prompt: "revert that. read src/error.rs first, then map the failure onto the variant that exists",
    file: "db/queries/events.rs",
    lines: [
      { sign: "+", text: "use crate::error::DbError;" },
      { sign: "+", text: "" },
      { sign: "+", text: "let rows = sqlx::query_as!(RunEvent, EVENTS_SQL, run_id)" },
      { sign: "+", text: "    .fetch_all(conn)" },
      { sign: "+", text: "    .await" },
      { sign: "+", text: "    .map_err(DbError::from)?;" },
    ],
    verdict: { label: "suite green · deploying", tone: "amber" },
  },
];

const TYPE_MS = 22;
const LINE_MS = 130;
const HOLD_MS = 2600;

export function HeroConsole() {
  const [beat, setBeat] = useState(0);
  // The wire lags the prompt: the previous diff stays on screen while the next
  // prompt is being typed, the way a broadcast holds the last shot.
  const [wireBeat, setWireBeat] = useState(0);
  const [typed, setTyped] = useState(BEATS[0].prompt);
  const [lines, setLines] = useState(BEATS[0].lines.length);
  const [verdict, setVerdict] = useState(true);
  const [elapsed, setElapsed] = useState(5192);
  const [viewers, setViewers] = useState(12840);

  // Elapsed clock + a viewer count that drifts, both client-only.
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed((s) => s + 1);
      setViewers((v) => v + ((v * 7 + 13) % 5) - 2);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // The loop: hold → clear → type the prompt → land the diff → verdict.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];

    timers.push(
      setTimeout(() => {
        const next = (beat + 1) % BEATS.length;
        const target = BEATS[next];
        setBeat(next);
        setTyped("");

        let i = 0;
        const typer = setInterval(() => {
          i += 1;
          setTyped(target.prompt.slice(0, i));
          if (i >= target.prompt.length) {
            clearInterval(typer);
            // Prompt is sent — now the wire cuts to the diff it came back with.
            setWireBeat(next);
            setVerdict(false);
            setLines(0);
            let l = 0;
            const liner = setInterval(() => {
              l += 1;
              setLines(l);
              if (l >= target.lines.length) {
                clearInterval(liner);
                timers.push(setTimeout(() => setVerdict(true), 420));
              }
            }, LINE_MS);
            intervals.push(liner);
          }
        }, TYPE_MS);
        intervals.push(typer);
      }, HOLD_MS),
    );

    return () => {
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
    };
  }, [beat]);

  const shot = BEATS[wireBeat];
  const verdictTone = {
    add: "text-add",
    del: "text-del",
    amber: "text-amber",
  }[shot.verdict.tone];

  return (
    <div className="panel overflow-hidden">
      {/* On-air bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge-soft bg-ink-2 px-3 py-2">
        <LiveBadge />
        <Link
          href="/watch/nocturne"
          className="font-mono text-xs text-bone transition-colors hover:text-amber"
        >
          @nocturne
        </Link>
        <span className="font-mono text-[11px] text-faint">RUN-4821 · Claude Code · opus-5</span>
        <span className="ml-auto font-mono text-[11px] text-muted tabular-nums">
          {timecode(elapsed)} · {compact(viewers)} watching
        </span>
      </div>

      <div className="grid md:grid-cols-2">
        {/* Prompt-Cam */}
        <div className="border-b border-edge-soft p-4 md:border-r md:border-b-0">
          <p className="eyebrow">Prompt-Cam</p>
          <p className="mt-3 min-h-[7.5rem] font-mono text-[13px] leading-relaxed text-bone sm:min-h-[6rem]">
            <span className="mr-1.5 text-amber">›</span>
            {typed}
            <span className="caret" aria-hidden />
          </p>
          <p className="mt-4 font-mono text-[10px] tracking-[0.14em] text-faint uppercase">
            No face cam. The prompt is the performance.
          </p>
        </div>

        {/* The diff that came back */}
        <div className="bg-ink-2/60 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="eyebrow">The Wire</p>
            <p className="font-mono text-[10px] text-faint">{shot.file}</p>
          </div>
          <pre className="scrollbar-thin mt-3 min-h-[7.5rem] overflow-x-auto font-mono text-[12px] leading-[1.55] sm:min-h-[6rem]">
            {shot.lines.slice(0, lines).map((line, i) => (
              <div
                key={i}
                className={
                  line.sign === "+"
                    ? "text-add"
                    : line.sign === "-"
                      ? "text-del"
                      : "text-faint"
                }
              >
                <span className="mr-2 inline-block w-2 text-faint">{line.sign}</span>
                {line.text}
              </div>
            ))}
          </pre>
          <p
            className={`mt-4 font-mono text-[10px] tracking-[0.14em] uppercase transition-opacity ${verdictTone} ${
              verdict ? "opacity-100" : "opacity-0"
            }`}
          >
            {shot.verdict.label}
          </p>
        </div>
      </div>
    </div>
  );
}
