"use client";

import { useEffect, useState } from "react";
import { LiveBadge } from "@/components/ui/bits";
import { compact, timecode } from "@/lib/format";

/**
 * The canvas. On the real thing this is the viber's screen; here it is a
 * simulated editor so the page can be read without a media server.
 *
 * The broadcast device is the lower-third: whatever prompt is in flight sits
 * across the bottom of the picture the way a name strap would on television.
 */

const FILES = ["session.rs", "events.rs", "pool.rs", "error.rs"];

const CODE: { indent: number; text: string; tone: "plain" | "key" | "str" | "com" | "fn" }[] = [
  { indent: 0, text: "pub async fn fetch_run_events(", tone: "fn" },
  { indent: 1, text: "conn: &mut PgConnection,", tone: "plain" },
  { indent: 1, text: "run_id: RunId,", tone: "plain" },
  { indent: 0, text: ") -> Result<Vec<RunEvent>, DbError> {", tone: "fn" },
  { indent: 1, text: "// one statement, no builder, no surprises", tone: "com" },
  { indent: 1, text: "let rows = sqlx::query_as!(", tone: "key" },
  { indent: 2, text: "RunEvent,", tone: "plain" },
  { indent: 2, text: '"select * from run_events where run_id = $1",', tone: "str" },
  { indent: 2, text: "run_id", tone: "plain" },
  { indent: 1, text: ")", tone: "plain" },
  { indent: 2, text: ".fetch_all(conn)", tone: "fn" },
  { indent: 2, text: ".await", tone: "key" },
  { indent: 2, text: ".map_err(DbError::from)?;", tone: "plain" },
  { indent: 1, text: "Ok(rows)", tone: "key" },
  { indent: 0, text: "}", tone: "plain" },
];

const TERMINAL = [
  { text: "$ cargo test -p db", tone: "prompt" },
  { text: "   Compiling db v0.4.1", tone: "dim" },
  { text: "    Finished test profile in 4.21s", tone: "dim" },
  { text: "running 16 tests", tone: "dim" },
  { text: "test events::fetch_all_for_run ... ok", tone: "ok" },
  { text: "test result: ok. 16 passed; 0 failed", tone: "ok" },
];

const TONE_CLASS = {
  plain: "text-bone/85",
  key: "text-amber",
  str: "text-add",
  com: "text-faint italic",
  fn: "text-teal",
} as const;

const TERM_CLASS = {
  prompt: "text-bone",
  dim: "text-faint",
  ok: "text-add",
} as const;

export function StreamCanvas({
  handle,
  code,
  elapsed: startElapsed,
  viewers: startViewers,
  lowerThird,
}: {
  handle: string;
  code: string;
  elapsed: number;
  viewers: number;
  lowerThird: string;
}) {
  const [elapsed, setElapsed] = useState(startElapsed);
  const [viewers, setViewers] = useState(startViewers);
  const [visible, setVisible] = useState(CODE.length);
  const [termLines, setTermLines] = useState(TERMINAL.length);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed((s) => s + 1);
      setViewers((v) => v + ((v * 3 + 7) % 7) - 3);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Retype the file on a loop so the picture is never frozen.
  useEffect(() => {
    let line = 0;
    let phase: "code" | "term" = "code";
    const id = setInterval(() => {
      if (phase === "code") {
        line += 1;
        setVisible(line);
        if (line >= CODE.length) {
          phase = "term";
          line = 0;
          setTermLines(0);
        }
      } else {
        line += 1;
        setTermLines(line);
        if (line >= TERMINAL.length) {
          phase = "code";
          line = 0;
        }
      }
    }, 380);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative overflow-hidden border border-edge-soft bg-[#0c0812]">
      {/* editor chrome */}
      <div className="scrollbar-thin flex items-center overflow-x-auto border-b border-edge-soft bg-ink-2">
        {FILES.map((f, i) => (
          <span
            key={f}
            className={`shrink-0 border-r border-edge-soft px-3 py-1.5 font-mono text-[11px] ${
              i === 1 ? "bg-panel text-bone" : "text-faint"
            }`}
          >
            {f}
          </span>
        ))}
        <span className="ml-auto shrink-0 px-3 font-mono text-[10px] text-faint">{code}</span>
      </div>

      {/* Taller on phones — 16/9 leaves room for about four lines of code. */}
      <div className="relative aspect-[4/3] sm:aspect-[16/9]">
        {/* Code pane. The top padding is the safe area under the on-air overlay. */}
        <div className="scrollbar-thin h-[62%] overflow-hidden px-4 pt-11 pb-4">
          <pre className="font-mono text-[12px] leading-[1.6] sm:text-[13px]">
            {CODE.map((line, i) => (
              <div
                key={i}
                className={`${TONE_CLASS[line.tone]} transition-opacity duration-200 ${
                  i < visible ? "opacity-100" : "opacity-0"
                }`}
              >
                <span className="mr-4 inline-block w-5 text-right text-faint/50 tabular-nums select-none">
                  {i + 1}
                </span>
                {"  ".repeat(line.indent)}
                {line.text}
                {i === visible - 1 && <span className="caret" aria-hidden />}
              </div>
            ))}
          </pre>
        </div>

        {/* terminal pane */}
        <div className="h-[38%] border-t border-edge-soft bg-[#080510] p-4">
          <pre className="font-mono text-[11px] leading-[1.7] sm:text-[12px]">
            {TERMINAL.map((line, i) => (
              <div
                key={i}
                className={`${TERM_CLASS[line.tone as keyof typeof TERM_CLASS]} transition-opacity duration-200 ${
                  i < termLines ? "opacity-100" : "opacity-0"
                }`}
              >
                {line.text}
              </div>
            ))}
          </pre>
        </div>

        {/* on-air overlay */}
        <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2">
          <LiveBadge />
          <span className="bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-muted tabular-nums">
            {timecode(elapsed)}
          </span>
          <span className="bg-ink/75 px-1.5 py-0.5 font-mono text-[10px] text-muted tabular-nums">
            {compact(viewers)} watching
          </span>
        </div>

        {/* lower-third: the prompt in flight */}
        <div className="pointer-events-none absolute right-0 bottom-0 left-0 border-t border-amber/30 bg-gradient-to-t from-ink via-ink/92 to-transparent px-4 pt-6 pb-3">
          <p className="font-mono text-[10px] tracking-[0.18em] text-amber uppercase">
            @{handle} is prompting
          </p>
          <p className="mt-1 line-clamp-2 font-mono text-[12px] leading-snug text-bone sm:text-[13px]">
            {lowerThird}
            <span className="caret" aria-hidden />
          </p>
        </div>
      </div>
    </div>
  );
}
