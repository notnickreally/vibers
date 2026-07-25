"use client";

import { useState } from "react";
import Link from "next/link";
import { LiveBadge, Poster } from "@/components/ui/bits";
import type { Tool } from "@/lib/mock/types";
import { parseYouTube, thumbnailUrl } from "@/lib/youtube";

const TOOLS: Tool[] = ["Claude Code", "Cursor", "Codex", "Zed", "Windsurf"];
const STACKS = ["Next.js", "Rust", "Python", "Swift", "Godot", "Solidity", "Go", "Three.js"];

/**
 * A run starts with a declared goal — that is the whole gate. This composer
 * shows the card the network will see the moment the tally goes on, so nobody
 * goes live with a title they haven't read back.
 */
export function GoLiveComposer() {
  const [goal, setGoal] = useState("");
  const [feed, setFeed] = useState("");
  // A private or mistyped id has no thumbnail; fall back to the plain poster.
  const [posterFailed, setPosterFailed] = useState(false);
  const [tool, setTool] = useState<Tool>("Claude Code");
  const [stacks, setStacks] = useState<string[]>(["Next.js"]);
  const [promptCam, setPromptCam] = useState(true);
  const [wire, setWire] = useState(true);
  const [coPrompt, setCoPrompt] = useState(true);

  const source = parseYouTube(feed);
  const feedTouched = feed.trim().length > 0;
  // A goal is what makes a broadcast a *run*; without one you still get a page,
  // it just doesn't claim to be chasing anything.
  const hasGoal = goal.trim().length >= 12;
  const ready = hasGoal || !!source;
  // Going live routes to your own run page, carrying the feed on the URL.
  const tallyHref = source ? `/watch/nocturne?v=${source.id}` : "/watch/nocturne";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="space-y-6">
        <div>
          <label htmlFor="goal" className="eyebrow block">
            Declare the goal — optional
          </label>
          <p className="mt-2 text-sm text-muted">
            One sentence, in the present tense, describing what has to be true for the run
            to count as shipped. Leave it blank and you still go live — the broadcast just
            isn&apos;t chasing anything, and won&apos;t be scored as a run.
          </p>
          <textarea
            id="goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            maxLength={120}
            placeholder="Rip out the ORM and hand-write the query layer before sunrise"
            className="mt-3 w-full resize-none border border-edge bg-panel px-3 py-3 font-mono text-[14px] leading-relaxed text-bone placeholder:text-faint focus:border-amber focus:outline-none"
          />
          <p className="mt-1.5 flex justify-between font-mono text-[10px] text-faint">
            <span>
              {hasGoal
                ? "Locked once the tally is on"
                : goal.length > 0
                  ? "At least 12 characters, or leave it blank"
                  : "Optional"}
            </span>
            <span className="tabular-nums">{goal.length}/120</span>
          </p>
        </div>

        <div>
          <label htmlFor="feed" className="eyebrow block">
            Point the picture at a stream
          </label>
          <p className="mt-2 text-sm text-muted">
            Paste the YouTube URL you&apos;re broadcasting to — a live stream, a premiere,
            or a recorded run. That video becomes the picture on your run page, with the
            Prompt-Cam and the Wire around it. It has to be your own stream: feeds can only
            be attached by the person broadcasting them.
          </p>
          <input
            id="feed"
            value={feed}
            onChange={(e) => {
              setFeed(e.target.value);
              setPosterFailed(false);
            }}
            placeholder="https://www.youtube.com/live/…"
            className={`mt-3 w-full border bg-panel px-3 py-2.5 font-mono text-[13px] text-bone placeholder:text-faint focus:outline-none ${
              feedTouched && !source ? "border-del" : "border-edge focus:border-amber"
            }`}
          />
          <p
            className={`mt-1.5 font-mono text-[10px] ${
              feedTouched && !source ? "text-del" : "text-faint"
            }`}
          >
            {feedTouched && !source
              ? "Not a YouTube link. Try youtube.com/watch, youtu.be or /live/."
              : source
                ? `Feed locked: ${source.id}`
                : "Leave it empty and the run shows the editor feed instead."}
          </p>
        </div>

        <fieldset>
          <legend className="eyebrow">Tool</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {TOOLS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTool(t)}
                aria-pressed={tool === t}
                className={`border px-3 py-1.5 font-mono text-[11px] transition-colors ${
                  tool === t
                    ? "border-amber bg-amber/12 text-amber"
                    : "border-edge-soft text-muted hover:border-edge hover:text-bone"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="eyebrow">Stack — pick up to three</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {STACKS.map((s) => {
              const on = stacks.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setStacks((prev) =>
                      on ? prev.filter((x) => x !== s) : prev.length >= 3 ? prev : [...prev, s],
                    )
                  }
                  className={`border px-3 py-1.5 font-mono text-[11px] transition-colors ${
                    on
                      ? "border-teal bg-teal/12 text-teal"
                      : "border-edge-soft text-muted hover:border-edge hover:text-bone"
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="eyebrow">Surfaces</legend>
          <div className="mt-3 space-y-px border border-edge-soft bg-edge-soft">
            {[
            {
              on: promptCam,
              set: setPromptCam,
              title: "Prompt-Cam",
              body: "Every prompt appears on screen as you type it, with token counts.",
            },
            {
              on: wire,
              set: setWire,
              title: "The Wire",
              body: "Commits, test runs and deploys stream to the network as they land.",
            },
            {
              on: coPrompt,
              set: setCoPrompt,
              title: "Co-prompt",
              body: "Chat can file prompt suggestions. You still choose what gets sent.",
            },
          ].map((row) => (
            <label
              key={row.title}
              className="flex cursor-pointer items-start gap-3 bg-ink p-4 transition-colors hover:bg-panel"
            >
              <input
                type="checkbox"
                checked={row.on}
                onChange={(e) => row.set(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-amber)]"
              />
              <span>
                <span className="block font-mono text-xs text-bone">{row.title}</span>
                <span className="mt-1 block text-[13px] leading-relaxed text-muted">{row.body}</span>
              </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {/* ------------------------------------------------------------ preview */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <p className="eyebrow mb-3">What the network will see</p>
        <Poster tone={1} className="aspect-[16/10]">
          {/* Once a feed is set, the poster shows its actual frame. */}
          {source && !posterFailed && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={source.id}
                src={thumbnailUrl(source)}
                alt=""
                onError={() => setPosterFailed(true)}
                className="absolute inset-0 h-full w-full object-cover opacity-45"
              />
              <div aria-hidden className="absolute inset-0 bg-ink/35" />
            </>
          )}
          <div className="relative flex h-full flex-col justify-between p-3">
            <div className="flex items-start justify-between">
              <LiveBadge />
              <span className="bg-ink/70 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                00:00:00
              </span>
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-[0.14em] text-amber/80">RUN-4831</p>
              <p className="mt-1 line-clamp-3 font-display text-[15px] leading-snug font-semibold text-bone">
                {goal.trim() || "Your goal goes here, and the whole network reads it first."}
              </p>
            </div>
            <div className="flex items-end justify-between font-mono text-[10px] text-faint">
              <span>
                <span className="text-add">+0</span> <span className="text-del">−0</span> 0f
              </span>
              <span>0 prompts</span>
            </div>
          </div>
        </Poster>

        <div className="mt-4 space-y-2 font-mono text-[11px] text-faint">
          <p>
            <span className="text-muted">tool</span> {tool}
          </p>
          <p>
            <span className="text-muted">stack</span> {stacks.join(", ") || "—"}
          </p>
          <p>
            <span className="text-muted">surfaces</span>{" "}
            {[promptCam && "prompt-cam", wire && "wire", coPrompt && "co-prompt"]
              .filter(Boolean)
              .join(", ") || "none"}
          </p>
          <p>
            <span className="text-muted">picture</span>{" "}
            {source ? `youtube · ${source.id}` : "editor feed"}
          </p>
        </div>

        {ready ? (
          <Link
            href={tallyHref}
            className="mt-5 block w-full bg-tally px-4 py-3 text-center font-mono text-xs font-semibold tracking-[0.14em] text-ink uppercase transition-colors hover:bg-bone"
          >
            Hit the tally
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="mt-5 w-full cursor-not-allowed border border-edge px-4 py-3 font-mono text-xs font-semibold tracking-[0.14em] text-faint uppercase"
          >
            Add a goal or a feed
          </button>
        )}
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-faint">
          {source
            ? "Opens your run page with this feed playing."
            : "Prototype build — the run page opens with the simulated editor feed."}
        </p>
        <p className="mt-3 border-t border-edge-soft pt-3 font-mono text-[10px] leading-relaxed text-faint">
          Relaying someone else&apos;s stream instead?{" "}
          <Link href="/relay" className="text-teal underline-offset-4 hover:underline">
            Use a relay
          </Link>{" "}
          — the URL is the only thing it needs.
        </p>
      </div>
    </div>
  );
}
