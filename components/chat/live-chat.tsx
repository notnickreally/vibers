"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { LiveBadge } from "@/components/ui/bits";
import {
  type ChatMessage,
  clearMessages,
  isChatKey,
  listMessages,
  loadHandle,
  MAX_BODY,
  MAX_HANDLE,
  mintHandle,
  saveHandle,
  sendMessage,
  stamp,
} from "@/lib/chat";

/**
 * The chat under the picture.
 *
 * It is honest about what it is. There is no chat server behind vibers.tv, so
 * this is your own transcript against this video, kept in this browser — which
 * the panel says out loud rather than simulating a room full of people. The
 * one thing that is genuinely live is other tabs of yours on the same video:
 * they pick messages up through the `storage` event as they are sent.
 *
 * Why it isn't hidden on non-live videos: `isLive` is only ever true when the
 * YouTube Data API confirmed it, which needs `YOUTUBE_API_KEY` — without a key
 * every stream reads `undefined`, and a hard live-only gate would mean the
 * panel never appeared at all. So the panel is always under the player and the
 * *heading* carries the truth: the tally lamp and the words "Live chat" only
 * when the stream is confirmed live, plain "Comments" otherwise.
 *
 * All of the logic — validation, the cap, hostile stored JSON, the timestamp —
 * lives in `lib/chat.ts` and is unit-tested there. What is left here is the
 * markup and the two browser behaviours that need a DOM: cross-tab sync and
 * the scroll position.
 */

/** How close to the bottom still counts as "reading the newest", in px. */
const PINNED_SLACK = 48;

export function LiveChat({ videoId, isLive }: { videoId: string; isLive?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [handle, setHandle] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);
  const pinnedRef = useRef(true);

  // Storage is only readable on the client, and the handle is minted from a
  // random draw — so both wait for mount. Nothing here runs during render.
  useEffect(() => {
    setMessages(listMessages(videoId));
    setHandle((current) => {
      if (current) return current;
      const stored = loadHandle();
      if (stored) return stored;
      const minted = mintHandle(Math.random());
      saveHandle(minted);
      return minted;
    });
    setReady(true);
  }, [videoId]);

  // Another tab sent something. `storage` never fires in the tab that wrote,
  // so the composer updates its own state directly; and it fires for every
  // key in the origin, so it is filtered down to this video's transcript.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (!isChatKey(event.key, videoId)) return;
      setMessages(listMessages(videoId));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [videoId]);

  // Jump to the newest only for someone already at the bottom — never yank the
  // viewport out from under someone reading back through the transcript.
  useEffect(() => {
    const log = logRef.current;
    if (!log || !pinnedRef.current || messages.length === 0) return;
    log.scrollTop = log.scrollHeight;
  }, [messages]);

  const onScroll = useCallback(() => {
    const log = logRef.current;
    if (!log) return;
    pinnedRef.current = log.scrollHeight - log.scrollTop - log.clientHeight <= PINNED_SLACK;
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = sendMessage(videoId, {
      handle,
      body: draft,
      id: `${videoId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sentAt: Date.now(),
    });
    setMessages(result.messages);
    setError(result.error ?? "");
    if (result.ok) {
      setDraft("");
      // Your own message always pulls the transcript back to the bottom.
      pinnedRef.current = true;
    }
  }

  function onClear() {
    clearMessages(videoId);
    setMessages([]);
    setError("");
  }

  const live = isLive === true;
  const inputBase =
    "border border-edge bg-ink px-3 py-2 font-mono text-[12px] text-bone placeholder:text-faint focus:border-amber focus:outline-none";

  return (
    <section
      aria-labelledby="chat-heading"
      className="mt-8 border border-edge-soft bg-ink-2"
      data-live={live ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-edge-soft px-4 py-3">
        <h2 id="chat-heading" className="eyebrow">
          {live ? "Live chat" : "Comments"}
        </h2>
        {live && <LiveBadge />}
        <span className="ml-auto font-mono text-[10px] text-faint tabular-nums">
          {messages.length} {messages.length === 1 ? "message" : "messages"}
        </span>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="font-mono text-[10px] tracking-[0.12em] text-faint uppercase transition-colors hover:text-del"
          >
            Clear
          </button>
        )}
      </div>

      <p className="border-b border-edge-soft px-4 py-2.5 font-mono text-[10px] leading-relaxed text-faint">
        Prototype build — vibers.tv has no chat server yet. Messages are kept in this browser
        against this video and are not sent anywhere. Your other tabs on this stream see them.
      </p>

      <ol
        ref={logRef}
        onScroll={onScroll}
        // A log rather than a live region over the whole list: only appends
        // are announced, so a reload doesn't read the transcript back out.
        aria-live="polite"
        className="max-h-[380px] min-h-[140px] space-y-3 overflow-y-auto px-4 py-4"
      >
        {ready && messages.length === 0 && (
          <li className="border border-dashed border-edge p-4 font-mono text-[11px] leading-relaxed text-faint">
            Nothing said yet.{" "}
            {live ? "The stream is up — say something." : "Leave the first note on this video."}
          </li>
        )}
        {messages.map((m) => (
          <li key={m.id} className="flex gap-3">
            <span className="w-10 shrink-0 pt-0.5 font-mono text-[10px] text-faint tabular-nums">
              {stamp(m.sentAt)}
            </span>
            <span className="min-w-0">
              <span className="font-mono text-[11px] text-teal">{m.handle}</span>
              <span className="mt-0.5 block text-[13px] leading-snug break-words text-bone">
                {m.body}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <form onSubmit={onSubmit} className="border-t border-edge-soft px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="chat-handle" className="sr-only">
            Your handle
          </label>
          <input
            id="chat-handle"
            value={handle}
            maxLength={MAX_HANDLE}
            onChange={(e) => setHandle(e.target.value)}
            onBlur={() => saveHandle(handle)}
            className={`${inputBase} w-32 shrink-0 text-teal`}
            placeholder="handle"
          />
          <label htmlFor="chat-body" className="sr-only">
            Message
          </label>
          <input
            id="chat-body"
            value={draft}
            maxLength={MAX_BODY}
            onChange={(e) => setDraft(e.target.value)}
            className={`${inputBase} min-w-0 flex-1`}
            placeholder={live ? "Say something to the stream…" : "Leave a note…"}
          />
          <button
            type="submit"
            className="bg-amber px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
          >
            Send
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 font-mono text-[10px] text-del">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
