"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Poster } from "@/components/ui/bits";
import type { Relay } from "@/lib/mock/types";
import { findRelay, listRelays, relayHref, removeRelay, saveRelay } from "@/lib/relay";
import { CURRENT_VIBER } from "@/lib/session";
import { parseYouTube, thumbnailUrl } from "@/lib/youtube";

/**
 * Relay a stream. The URL is the only required field — everything below it is
 * optional and stays empty unless you actually write something, because the
 * point of this surface is to carry someone's stream without putting words in
 * their mouth.
 */
export function RelayComposer({ editId }: { editId?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [tool, setTool] = useState("");
  const [stack, setStack] = useState("");
  const [posterFailed, setPosterFailed] = useState(false);
  const [mine, setMine] = useState<Relay[]>([]);

  useEffect(() => {
    setMine(listRelays());
    if (!editId) return;
    const existing = findRelay(editId);
    if (!existing) {
      setUrl(editId);
      return;
    }
    setUrl(`https://www.youtube.com/watch?v=${existing.videoId}`);
    setTitle(existing.title ?? "");
    setNote(existing.note ?? "");
    setTool(existing.tool ?? "");
    setStack(existing.stacks?.join(", ") ?? "");
  }, [editId]);

  const source = parseYouTube(url);
  const touched = url.trim().length > 0;

  function build(): Relay | null {
    if (!source) return null;
    const stacks = stack
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const described = !!(title.trim() || note.trim() || tool.trim() || stacks.length);
    return {
      videoId: source.id,
      start: source.start,
      title: title.trim() || undefined,
      note: note.trim() || undefined,
      tool: tool.trim() || undefined,
      stacks: stacks.length ? stacks : undefined,
      // Credit only attaches when there is something to credit.
      relayedBy: described ? CURRENT_VIBER : undefined,
    };
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const relay = build();
    if (!relay) return;
    saveRelay(relay);
    router.push(relayHref(relay));
  }

  const preview = build();

  return (
    <div className="space-y-14">
      <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="min-w-0 space-y-8">
          <div>
            <label htmlFor="relay-url" className="eyebrow block">
              YouTube URL — the only thing required
            </label>
            <input
              id="relay-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setPosterFailed(false);
              }}
              placeholder="https://www.youtube.com/live/…"
              className={`mt-3 w-full border bg-panel px-3 py-2.5 font-mono text-[13px] text-bone placeholder:text-faint focus:outline-none ${
                touched && !source ? "border-del" : "border-edge focus:border-amber"
              }`}
            />
            <p
              className={`mt-1.5 font-mono text-[10px] ${
                touched && !source ? "text-del" : "text-faint"
              }`}
            >
              {touched && !source
                ? "Not a YouTube link. Try youtube.com/watch, youtu.be or /live/."
                : source
                  ? `Ready to relay: ${source.id}`
                  : "Live streams, premieres and recorded videos all work."}
            </p>
          </div>

          <div className="border-t border-edge-soft pt-8">
            <p className="eyebrow text-amber">Everything below is optional</p>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              Leave it all blank and the relay is just the video — which is the safest
              thing to post about someone else&apos;s stream. Anything you do write is
              shown as yours, not as something the creator said.
            </p>
          </div>

          <div>
            <label htmlFor="relay-title" className="eyebrow block">
              Title
            </label>
            <input
              id="relay-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Optional — how you'd describe it to someone scrolling past"
              className="mt-3 w-full border border-edge bg-panel px-3 py-2.5 text-[15px] text-bone placeholder:text-faint focus:border-amber focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="relay-note" className="eyebrow block">
              Why you&apos;re relaying it
            </label>
            <textarea
              id="relay-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={400}
              placeholder="Optional — your own words about why it's worth watching"
              className="mt-3 w-full resize-none border border-edge bg-panel px-3 py-2.5 text-sm leading-relaxed text-bone placeholder:text-faint focus:border-amber focus:outline-none"
            />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor="relay-tool" className="eyebrow block">
                Tool
              </label>
              <input
                id="relay-tool"
                value={tool}
                onChange={(e) => setTool(e.target.value)}
                placeholder="Optional"
                className="mt-3 w-full border border-edge bg-panel px-3 py-2 font-mono text-[13px] text-bone placeholder:text-faint focus:border-amber focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="relay-stack" className="eyebrow block">
                Stack
              </label>
              <input
                id="relay-stack"
                value={stack}
                onChange={(e) => setStack(e.target.value)}
                placeholder="Optional — comma separated"
                className="mt-3 w-full border border-edge bg-panel px-3 py-2 font-mono text-[13px] text-bone placeholder:text-faint focus:border-amber focus:outline-none"
              />
            </div>
          </div>
          <p className="max-w-xl font-mono text-[10px] leading-relaxed text-faint">
            Only fill in the tool and stack if you actually know them. Guessing attaches a
            company&apos;s name to someone who never mentioned it.
          </p>
        </div>

        {/* ------------------------------------------------------------ preview */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="eyebrow mb-3">What gets posted</p>
          <Poster tone={2} className="aspect-video">
            {source && !posterFailed && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={source.id}
                  src={thumbnailUrl(source)}
                  alt=""
                  onError={() => setPosterFailed(true)}
                  className="absolute inset-0 h-full w-full object-cover opacity-60"
                />
                <div aria-hidden className="absolute inset-0 bg-ink/30" />
              </>
            )}
            <div className="relative flex h-full flex-col justify-between p-3">
              <span className="w-fit border border-edge bg-ink/70 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">
                Relay
              </span>
              <p className="font-display text-[15px] leading-snug font-semibold text-bone">
                {title.trim() || (source ? "Untitled relay" : "Paste a URL to preview")}
              </p>
            </div>
          </Poster>

          <div className="mt-4 space-y-2 font-mono text-[11px] text-faint">
            <p>
              <span className="text-muted">video</span> {source?.id ?? "—"}
            </p>
            <p>
              <span className="text-muted">described</span>{" "}
              {preview?.relayedBy ? `yes, credited to @${preview.relayedBy}` : "no — video only"}
            </p>
          </div>

          <button
            type="submit"
            disabled={!source}
            className="mt-5 w-full px-4 py-3 font-mono text-xs font-semibold tracking-[0.14em] uppercase transition-colors disabled:cursor-not-allowed disabled:border disabled:border-edge disabled:bg-transparent disabled:text-faint enabled:bg-amber enabled:text-ink enabled:hover:bg-bone"
          >
            {source ? "Put it on the network" : "Paste a URL first"}
          </button>
          <p className="mt-2 font-mono text-[10px] text-faint">
            Relays are saved in this browser and shared by link.
          </p>
        </div>
      </form>

      {/* -------------------------------------------------------------- yours */}
      {mine.length > 0 && (
        <section className="border-t border-edge-soft pt-8">
          <div className="mb-5 flex items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Your relays</p>
              <h2 className="mt-1 font-display text-xl font-semibold text-bone">
                Saved in this browser
              </h2>
            </div>
            <p className="font-mono text-[11px] text-faint">{mine.length} saved</p>
          </div>
          <ul className="divide-y divide-edge-soft border border-edge-soft">
            {mine.map((r) => (
              <li key={r.videoId} className="flex flex-wrap items-center gap-4 p-4">
                <Link href={relayHref(r)} className="min-w-0 flex-1">
                  <p className="truncate text-sm text-bone hover:text-amber">
                    {r.title ?? "Untitled relay"}
                  </p>
                  <p className="font-mono text-[11px] text-faint">
                    youtube.com/watch?v={r.videoId}
                    {r.relayedBy ? ` · described by @${r.relayedBy}` : " · video only"}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => setMine(removeRelay(r.videoId))}
                  className="border border-edge px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-muted uppercase transition-colors hover:border-del hover:text-del"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
