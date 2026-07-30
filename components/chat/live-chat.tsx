"use client";

import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { LiveBadge } from "@/components/ui/bits";
import {
  canReloadChat,
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
  openSignIn,
  pollSignIn,
  readClosed,
  saveHandle,
  sendMessage,
  SIGN_IN_POLL_MS,
  type SignInPhase,
  type SignInWindow,
  stamp,
} from "@/lib/chat";
import {
  chatFrameUrl,
  chatPopoutUrl,
  parseKey,
  PROVIDER_LABEL,
  sourceNoun,
} from "@/lib/source";
import { liveChatPopoutUrl, liveChatSignInUrl, liveChatUrl } from "@/lib/youtube";

/**
 * The chat beside the picture — two tabs over the same panel.
 *
 * **Beside it where there is room, under it where there isn't.** The watch page
 * places this panel, not the panel itself: `WatchView` moves it between the
 * left-hand column and the row under the stream by grid placement alone, so it
 * is the same element at every width and the frame below never remounts. All
 * this file knows is that its section may be handed a height — the grid stretches
 * it to the stream's — and when it is, the frame takes whatever the tab strip and
 * the notice under it leave. Under the picture it keeps its own fixed height,
 * because there is nothing there to line up with.
 *
 * **Live chat** is the stream's real one, carried in YouTube's own framable
 * `live_chat` document. No API key and no quota: the frame does its own
 * fetching, so vibers.tv never holds a message. Reading needs no account.
 * `lib/youtube.ts` documents the three non-obvious rules that make the frame
 * load at all.
 *
 * **Posting needs a sign-in, and it cannot happen in that frame.** Google
 * answers `X-Frame-Options: DENY` on its login, so the *Sign in* button inside
 * YouTube's embedded chat is a dead end — which is why this panel opens a real
 * top-level window instead, on YouTube's own `/signin?next=…` redirector,
 * landing the viewer in *this stream's* pop-out chat with a composer. vibers.tv
 * never sees a credential: the whole exchange happens on Google's origin.
 *
 * That window is also where posting keeps working afterwards. Safari's ITP and
 * Firefox's Total Cookie Protection partition YouTube's cookies inside our
 * frame, so a session established up there does not necessarily reach down
 * here, and no amount of reloading moves it between jars — the call that would,
 * `requestStorageAccess()`, belongs to YouTube's document, not ours. So the
 * reload is offered as a *maybe*, worded as one, and the frame is presented as
 * the read-along it reliably is.
 *
 * **Twitch carries its own chat, and none of the sign-in dance.** Twitch frames
 * `twitch.tv/embed/<login>/chat` under the same bargain YouTube makes — the
 * parent hostname, exactly — but its chat document has a working sign-in of its
 * own inside the frame, so there is no top-level window to open and no phase
 * machine to run. What Twitch does *not* have is a chat for a VOD or a clip:
 * there is no document to frame at all, so `chatFrameUrl` returns null and the
 * panel says so rather than showing a rectangle that will never fill.
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

/**
 * What the panel says while a sign-in is in flight.
 *
 * None of it claims a session. The window is cross-origin — whether anyone
 * signed in, and whether that account has a channel to post from, are both
 * unreadable from here — so every line describes what *we* did or what the
 * viewer can do next, and the reload is offered as a maybe rather than a fix.
 */
const SIGN_IN_STATUS: Record<SignInPhase, string> = {
  idle: "",
  waiting:
    "Sign-in window open. Finish there, then post from that window — it is this stream's chat, and it works in every browser.",
  blocked:
    "Your browser blocked that window. Open chat on YouTube instead — a plain link is never blocked, and you can sign in and post from there.",
  returned:
    "That window closed. Posting keeps working in it. If this browser also lets YouTube use its cookies inside the frame, reloading may pick your session up here — Safari and Firefox keep them apart, so it may not.",
  unreadable:
    "That window is YouTube's, so we cannot tell when you are done with it. Post from there, and reload here whenever you come back.",
};

export function LiveChat({ videoId, isLive }: { videoId: string; isLive?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [handle, setHandle] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<ChatTab>(() => initialTab(isLive));
  const [host, setHost] = useState<string | null>(null);
  const [phase, setPhase] = useState<SignInPhase>("idle");
  // Bumped to remount the frame, which is the only way to make it re-ask
  // YouTube who you are. Never minted during render — it's a counter, not a
  // random draw, so the server and the first client paint always agree.
  const [frameNonce, setFrameNonce] = useState(0);
  const logRef = useRef<HTMLOListElement>(null);
  const pinnedRef = useRef(true);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const winRef = useRef<SignInWindow | null>(null);
  const reloadRef = useRef<HTMLButtonElement>(null);
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
    // The sign-in was for *that* stream's chat, so it doesn't carry over — and
    // a stale "reload this frame" offer would point at a frame that no longer
    // exists. The window itself is left alone; it is the viewer's now.
    winRef.current = null;
    setPhase("idle");
    setFrameNonce(0);
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

  // Watch the sign-in window for the viewer coming back. There is no event for
  // it — `window.close` fires inside the closing window, which is YouTube's,
  // not ours — so a poll is the whole mechanism. It stops itself on the first
  // conclusive tick, on unmount, and on the cap inside `pollSignIn`.
  useEffect(() => {
    const win = winRef.current;
    if (phase !== "waiting" || !win) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const next = pollSignIn(readClosed(win), Date.now() - startedAt);
      if (next !== "waiting") setPhase(next);
    }, SIGN_IN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Coming back from the window swaps the controls under the reader's cursor,
  // so put the caret on the thing that just appeared rather than dropping focus
  // to the top of the document.
  useEffect(() => {
    if (canReloadChat(phase)) reloadRef.current?.focus();
  }, [phase]);

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

  function onSignIn(url: string) {
    // Already up: bring it forward rather than reopening — a second navigation
    // would throw away a half-typed password.
    const open = winRef.current;
    if (open && !readClosed(open)) {
      open.focus();
      setPhase("waiting");
      return;
    }
    const result = openSignIn(url, (u, target, features) => window.open(u, target, features));
    winRef.current = result.phase === "waiting" ? result.window : null;
    setPhase(result.phase);
  }

  function onReloadChat() {
    setFrameNonce((n) => n + 1);
    setPhase("idle");
  }

  const live = isLive === true;
  // Confirmed over: YouTube keeps the transcript but takes the composer away,
  // so there is nothing here to sign in *for*.
  const ended = isLive === false;
  // The key names its own platform, so the panel never has to be told which
  // one it is drawing. An unparseable key keeps the YouTube shape it has always
  // had, and lands in the same "this can't be framed" branch it always did.
  const source = parseKey(videoId);
  const twitch = source?.provider === "twitch" ? source : null;
  const platform = source ? PROVIDER_LABEL[source.provider] : "YouTube";
  const noun = source ? sourceNoun(source) : "video";
  /** Twitch keeps chat against a channel and nothing else — see the header. */
  const noChat = Boolean(twitch && twitch.kind !== "channel");
  const chatUrl = !host
    ? null
    : twitch
      ? chatFrameUrl(twitch, host)
      : liveChatUrl(videoId, host);
  const popoutUrl = twitch ? chatPopoutUrl(twitch) : liveChatPopoutUrl(videoId);
  // Twitch signs you in inside its own chat frame, so there is nothing to open.
  const signInUrl = twitch ? null : liveChatSignInUrl(videoId);
  const showReload = canReloadChat(phase);
  const inputBase =
    "border border-edge bg-ink px-3 py-2 font-mono text-[12px] text-bone placeholder:text-faint focus:border-amber focus:outline-none";
  /**
   * How the panel fills a column beside the stream.
   *
   * Only ever applied to the tab that is **open**. A `hidden` element is hidden
   * by a UA rule, and any author `display` — `flex` included — beats it, so
   * putting this on a closed tabpanel would show both at once at `2xl`. Below
   * that breakpoint it does nothing: the panel is under the picture, sized by
   * its own contents.
   */
  const fillColumn = "2xl:flex 2xl:min-h-0 2xl:flex-1 2xl:flex-col";
  /** And what the frame does with the room that leaves it. */
  const fillFrame = "2xl:h-auto 2xl:min-h-[360px] 2xl:flex-1";
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
      // No top margin: the panel is a region of the watch page's grid now, and
      // the gap between the rows is what used to be this margin. Beside the
      // stream there is nothing above it to be pushed away from.
      //
      // `@container` is here for the rows *inside* the panel, which have two
      // very different widths to survive: ~340px in the left-hand column and
      // most of the page underneath. A viewport query can't tell those apart —
      // both happen at 1536px and up — so they ask the panel instead. It is safe
      // to make this a query container precisely because the player is not in
      // it: `container-type` makes an element the containing block for fixed
      // descendants, which is how you break a fullscreen video.
      className="@container border border-edge-soft bg-ink-2 2xl:flex 2xl:h-full 2xl:flex-col"
      data-live={live ? "true" : "false"}
    >
      {/* The section still needs a name, but the tabs now carry the visible
          truth about which chat you are looking at — so the heading stays for
          the outline and the screen reader, not for the eye. */}
      <h2 id="chat-heading" className="sr-only">
        Chat
      </h2>

      <div className="flex flex-wrap items-center gap-5 border-b border-edge-soft px-4 pt-3 2xl:shrink-0">
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
        className={tab === "live" ? fillColumn : undefined}
      >
        {isLive === undefined && (
          <p className="border-b border-edge-soft px-4 py-2.5 font-mono text-[10px] leading-relaxed text-faint">
            Liveness unconfirmed — checking it needs{" "}
            {twitch ? (
              <>
                a <code>TWITCH_CLIENT_ID</code> and <code>TWITCH_CLIENT_SECRET</code>
              </>
            ) : (
              <>
                a <code>YOUTUBE_API_KEY</code>
              </>
            )}
            , so the tally lamp and the viewer count stay dark on this stream. See the README. The
            chat below is the {noun}&apos;s real one either way.
          </p>
        )}

        {host === null ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading live chat"
            className={`shimmer m-4 h-[420px] sm:h-[520px] ${fillFrame}`}
          />
        ) : noChat ? (
          // Not a failure — Twitch keeps no chat against a VOD or a clip, so
          // there is nothing here that could have loaded. Said plainly, next to
          // the tab that does work on one.
          <div className="m-4 border border-dashed border-edge p-6">
            <p className="max-w-lg text-sm leading-relaxed text-muted">
              A Twitch {noun} has no chat of its own — chat belongs to the channel,
              and only while it is on air. Open the channel on Twitch to join it, or keep your own
              transcript under <span className="text-bone">Notes</span>.
            </p>
          </div>
        ) : chatUrl === null ? (
          <div className="m-4 border border-del/40 bg-del/6 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="border border-del/50 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.16em] text-del uppercase">
                Failed
              </span>
              <p className="font-mono text-[11px] text-faint">
                {twitch ? "twitch" : "youtube"}/chat-unavailable
              </p>
            </div>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
              This chat can&apos;t be framed here. Either the {noun} isn&apos;t one {platform} would
              recognise, or this page is being served from a host{" "}
              {platform} won&apos;t accept as an embed domain.
            </p>
          </div>
        ) : (
          <iframe
            // Remounting is the only lever we have on this frame: it is
            // cross-origin, so its document cannot be told to reload, and
            // pointing `src` at a cache-buster would break the exact-match
            // `embed_domain` bargain. A new key is a new element and a new load.
            key={frameNonce}
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
            className={`block h-[420px] w-full border-0 sm:h-[520px] ${fillFrame}`}
          />
        )}

        {/* Permanent, not revealed on a timer. A refused frame looks exactly
            like a loading one from out here, so there is nothing to wait for —
            the honest move is to name the cases and always offer the way out.

            The link stays an ordinary anchor, and it is the base layer rather
            than a fallback: it needs no JavaScript, a popup blocker cannot stop
            it, and it is where the blocked state sends people. The button above
            it is the enhancement — same destination, one fewer sign-in click. */}
        <div className="border-t border-edge-soft px-4 py-3 2xl:shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            {/* In a narrow panel the notice takes its own line rather than
                being squeezed into a gutter beside the buttons. */}
            <p className="min-w-0 flex-1 font-mono text-[10px] leading-relaxed text-faint @max-[480px]:basis-full">
              {noChat ? (
                <>
                  Chat belongs to the Twitch channel that made this {noun}, and only while it is on
                  air. Notes below works on it either way.
                </>
              ) : twitch ? (
                <>
                  Chat comes from Twitch, and it stays open even when the channel is off air —
                  signing in happens inside the frame, on Twitch&apos;s own origin, so vibers.tv
                  never sees it. It stays empty if the channel turned chat off, or if your browser
                  blocks Twitch&apos;s cookies here; Safari does by default, and the pop-out always
                  works.
                </>
              ) : ended ? (
                <>
                  This broadcast has ended, so its chat is closed to new messages — there is
                  nothing left to sign in for. YouTube still shows the transcript where the
                  channel kept one.
                </>
              ) : (
                <>
                  Chat comes from YouTube. It stays empty if the stream isn&apos;t live, the
                  channel turned chat off, or your browser blocks YouTube&apos;s cookies — Safari
                  does by default. Posting happens in a YouTube window, on an account with a
                  channel; vibers.tv never sees your sign-in.
                </>
              )}
            </p>
            {!ended && signInUrl && (
              <button
                type="button"
                onClick={() => onSignIn(signInUrl)}
                className="shrink-0 bg-amber px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.1em] text-ink uppercase transition-colors hover:bg-bone"
              >
                {phase === "waiting" ? "Finish signing in ↗" : "Sign in to post ↗"}
                {/* The glyph is decoration; the promise has to be in the name. */}
                <span className="sr-only"> (opens a new window)</span>
              </button>
            )}
            {popoutUrl && (
              <a
                href={popoutUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 border border-edge px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] text-teal uppercase transition-colors hover:border-teal"
              >
                Open chat on {platform} ↗<span className="sr-only"> (opens a new tab)</span>
              </a>
            )}
          </div>

          {/* Mounted at every phase, empty at idle: a live region has to be in
              the document *before* its text changes, or the change goes
              unannounced. Polite, never assertive — none of this interrupts. */}
          <div
            className={`flex flex-wrap items-center gap-3 ${phase === "idle" ? "" : "mt-3"}`}
          >
            <p
              role="status"
              aria-live="polite"
              className={`min-w-0 flex-1 font-mono text-[10px] leading-relaxed @max-[480px]:basis-full ${
                phase === "blocked" ? "text-del" : "text-amber"
              }`}
            >
              {SIGN_IN_STATUS[phase]}
            </p>
            {showReload && (
              <button
                ref={reloadRef}
                type="button"
                onClick={onReloadChat}
                className="shrink-0 border border-edge px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] text-bone uppercase transition-colors hover:border-amber hover:text-amber"
              >
                Reload chat
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---- Notes ---- */}
      <div
        role="tabpanel"
        id="chat-panel-notes"
        aria-labelledby="chat-tab-notes"
        // Same as the live panel — the composer is the focusable content.
        hidden={tab !== "notes"}
        className={tab === "notes" ? fillColumn : undefined}
      >
        <p className="border-b border-edge-soft px-4 py-2.5 font-mono text-[10px] leading-relaxed text-faint 2xl:shrink-0">
          Your own notes on this {noun}. vibers.tv has no chat server — these are kept in this
          browser and are not sent anywhere. Your other tabs on this stream see them.
        </p>

        <ol
          ref={logRef}
          onScroll={onScroll}
          // A log rather than a live region over the whole list: only appends
          // are announced, so a reload doesn't read the transcript back out.
          aria-live="polite"
          // Beside the stream the transcript takes the column instead of a
          // capped 380px of it — same scroll, more of it visible.
          className="max-h-[380px] min-h-[140px] space-y-3 overflow-y-auto px-4 py-4 2xl:max-h-none 2xl:min-h-0 2xl:flex-1"
        >
          {ready && messages.length === 0 && (
            <li className="border border-dashed border-edge p-4 font-mono text-[11px] leading-relaxed text-faint">
              Nothing noted yet.{" "}
              {live ? "The stream is up — mark the moment." : `Leave the first note on this ${noun}.`}
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

        <form onSubmit={onSubmit} className="border-t border-edge-soft px-4 py-3 2xl:shrink-0">
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
              // Its own line in a narrow panel, so the note keeps a usable one.
              className={`${inputBase} w-32 shrink-0 text-teal @max-[480px]:w-full`}
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
