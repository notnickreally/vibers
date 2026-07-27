"use client";

import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { LiveBadge } from "@/components/ui/bits";
import {
  type ChatMessage,
  type ChatTab,
  clearMessages,
  initialTab,
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
import { liveChatPopoutUrl, liveChatUrl } from "@/lib/youtube";

/**
 * The chat under the picture — two tabs over the same panel.
 *
 * **Live chat** is the stream's real one, carried in YouTube's own framable
 * `live_chat` document. No API key and no quota: the frame does its own
 * fetching, so vibers.tv never holds a message. Reading needs no account;
 * posting needs a YouTube sign-in, inside their frame, where we never see it.
 * `lib/youtube.ts` documents the three non-obvious rules that make the frame
 * load at all.
 *
 * **Notes** is what this panel used to be in full: your own transcript against
 * this video, kept in this browser and sent nowhere, live across your own tabs
 * through the `storage` event. It stays because it is the only thing that
 * works on a VOD, where there is no chat to carry.
 *
 * The thing to understand before changing anything here: **a failed chat frame
 * is indistinguishable from a working one.** It is cross-origin, so `onload`
 * fires even when YouTube refuses to be framed, `onerror` never fires, an
 * invalid id comes back HTTP 200, and there is no postMessage handshake to
 * listen on. So there is no clever detection to write and no timeout worth
 * setting — the panel is honest instead, naming the cases that produce a blank
 * frame and always offering the way out to YouTube.
 *
 * Both panels stay mounted, the inactive one `hidden`, so switching tabs never
 * reloads the chat and never drops the session it may have signed into.
 */

/** How close to the bottom still counts as "reading the newest", in px. */
const PINNED_SLACK = 48;

const TABS: ChatTab[] = ["live", "notes"];

export function LiveChat({ videoId, isLive }: { videoId: string; isLive?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [handle, setHandle] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<ChatTab>(() => initialTab(isLive));
  const [host, setHost] = useState<string | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const pinnedRef = useRef(true);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Once someone has picked a tab, a late `isLive` must not pull it back.
  const touchedRef = useRef(false);

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
    // A different video is a fresh choice, not a continuation of the last one.
    touchedRef.current = false;
  }, [videoId]);

  // The embed domain has to be the live hostname, which only exists in a
  // browser — so the frame's URL cannot be built during render, and the first
  // paint is a placeholder at the frame's exact height rather than a shift.
  useEffect(() => {
    setHost(window.location.hostname);
  }, []);

  // `isLive` arrives from a lookup, so the opening tab is a guess until it
  // lands. Correct it once, and only while the choice is still ours.
  useEffect(() => {
    if (touchedRef.current) return;
    setTab(initialTab(isLive));
  }, [isLive]);

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

  // A hidden element has no scroll height, so a message that arrived while the
  // chat tab was open scrolled nothing. Re-pin when the log is on screen again,
  // otherwise the notes open at the top with the newest message out of sight.
  useEffect(() => {
    if (tab !== "notes") return;
    const log = logRef.current;
    if (!log || !pinnedRef.current) return;
    log.scrollTop = log.scrollHeight;
  }, [tab]);

  const onScroll = useCallback(() => {
    const log = logRef.current;
    if (!log) return;
    pinnedRef.current = log.scrollHeight - log.scrollTop - log.clientHeight <= PINNED_SLACK;
  }, []);

  const selectTab = useCallback((next: ChatTab) => {
    touchedRef.current = true;
    setTab(next);
  }, []);

  // Arrow keys move between tabs, Home/End jump to the ends — the half of the
  // tabs pattern that a plain row of buttons doesn't give you for free.
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.indexOf(tab);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    selectTab(TABS[next]);
    tabRefs.current[next]?.focus();
  }

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
  const chatUrl = host ? liveChatUrl(videoId, host) : null;
  const popoutUrl = liveChatPopoutUrl(videoId);
  const inputBase =
    "border border-edge bg-ink px-3 py-2 font-mono text-[12px] text-bone placeholder:text-faint focus:border-amber focus:outline-none";
  const tabBase =
    "border-b-2 px-1 pb-2 font-mono text-[11px] tracking-[0.12em] uppercase transition-colors";

  function tabClass(name: ChatTab) {
    return tab === name
      ? `${tabBase} border-amber text-amber`
      : `${tabBase} border-transparent text-faint hover:text-bone`;
  }

  return (
    <section
      aria-labelledby="chat-heading"
      className="mt-8 border border-edge-soft bg-ink-2"
      data-live={live ? "true" : "false"}
    >
      {/* The section still needs a name, but the tabs now carry the visible
          truth about which chat you are looking at — so the heading stays for
          the outline and the screen reader, not for the eye. */}
      <h2 id="chat-heading" className="sr-only">
        Chat
      </h2>

      <div className="flex flex-wrap items-center gap-5 border-b border-edge-soft px-4 pt-3">
        <div role="tablist" aria-labelledby="chat-heading" className="flex items-center gap-5">
          {TABS.map((name, i) => (
            <button
              key={name}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`chat-tab-${name}`}
              aria-selected={tab === name}
              aria-controls={`chat-panel-${name}`}
              // Roving tab stop: the tablist is one stop, arrows move inside it.
              tabIndex={tab === name ? 0 : -1}
              onClick={() => selectTab(name)}
              onKeyDown={onTabKeyDown}
              className={tabClass(name)}
            >
              <span className="flex items-center gap-2">
                {name === "live" ? "Live chat" : "Notes"}
                {name === "live" && live && <LiveBadge />}
              </span>
            </button>
          ))}
        </div>
        {tab === "notes" && (
          <>
            <span className="ml-auto pb-2 font-mono text-[10px] text-faint tabular-nums">
              {messages.length} {messages.length === 1 ? "message" : "messages"}
            </span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="pb-2 font-mono text-[10px] tracking-[0.12em] text-faint uppercase transition-colors hover:text-del"
              >
                Clear
              </button>
            )}
          </>
        )}
      </div>

      {/* ---- Live chat ---- */}
      <div
        role="tabpanel"
        id="chat-panel-live"
        aria-labelledby="chat-tab-live"
        // No tabIndex: a tabpanel only needs its own tab stop when it holds
        // nothing focusable, and this one always ends in the YouTube link.
        hidden={tab !== "live"}
      >
        {isLive === undefined && (
          <p className="border-b border-edge-soft px-4 py-2.5 font-mono text-[10px] leading-relaxed text-faint">
            Liveness unconfirmed — checking it needs a <code>YOUTUBE_API_KEY</code>, so the tally
            lamp and the viewer count stay dark on this stream. See the README. The chat below is
            the video&apos;s real one either way.
          </p>
        )}

        {host === null ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading live chat"
            className="shimmer m-4 h-[420px] sm:h-[520px]"
          />
        ) : chatUrl === null ? (
          <div className="m-4 border border-del/40 bg-del/6 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="border border-del/50 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.16em] text-del uppercase">
                Failed
              </span>
              <p className="font-mono text-[11px] text-faint">youtube/chat-unavailable</p>
            </div>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
              This chat can&apos;t be framed here. Either the video id isn&apos;t one YouTube would
              recognise, or this page is being served from a host YouTube won&apos;t accept as an
              embed domain.
            </p>
          </div>
        ) : (
          <iframe
            src={chatUrl}
            title="Live chat"
            // Below the player and usually below the fold — the same reason the
            // wall's monitor tiles defer.
            loading="lazy"
            // Set on purpose, and it must keep sending an origin: YouTube reads
            // the Referer alone to decide whether it will be framed, so
            // `no-referrer` here would blank the chat with no other symptom.
            // Deliberately not `sandbox` either — without `allow-same-origin`
            // YouTube gets an opaque origin and can't read its own cookies, and
            // with it a sandbox buys nothing across origins.
            referrerPolicy="strict-origin-when-cross-origin"
            className="block h-[420px] w-full border-0 sm:h-[520px]"
          />
        )}

        {/* Permanent, not revealed on a timer. A refused frame looks exactly
            like a loading one from out here, so there is nothing to wait for —
            the honest move is to name the cases and always offer the way out. */}
        <div className="flex flex-wrap items-center gap-3 border-t border-edge-soft px-4 py-3">
          <p className="min-w-0 flex-1 font-mono text-[10px] leading-relaxed text-faint">
            Chat comes from YouTube. It stays empty if the stream isn&apos;t live, the channel
            turned chat off, or your browser blocks YouTube&apos;s cookies — Safari does by
            default. Posting needs a YouTube sign-in.
          </p>
          {popoutUrl && (
            <a
              href={popoutUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 border border-edge px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] text-teal uppercase transition-colors hover:border-teal"
            >
              Open chat on YouTube ↗
            </a>
          )}
        </div>
      </div>

      {/* ---- Notes ---- */}
      <div
        role="tabpanel"
        id="chat-panel-notes"
        aria-labelledby="chat-tab-notes"
        // Same as the live panel — the composer is the focusable content.
        hidden={tab !== "notes"}
      >
        <p className="border-b border-edge-soft px-4 py-2.5 font-mono text-[10px] leading-relaxed text-faint">
          Your own notes on this video. vibers.tv has no chat server — these are kept in this
          browser and are not sent anywhere. Your other tabs on this stream see them.
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
              Nothing noted yet.{" "}
              {live ? "The stream is up — mark the moment." : "Leave the first note on this video."}
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
              Note
            </label>
            <input
              id="chat-body"
              value={draft}
              maxLength={MAX_BODY}
              onChange={(e) => setDraft(e.target.value)}
              className={`${inputBase} min-w-0 flex-1`}
              placeholder="Leave a note…"
            />
            <button
              type="submit"
              className="bg-amber px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
            >
              Save
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 font-mono text-[10px] text-del">
              {error}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
