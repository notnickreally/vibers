/**
 * The chat under a stream.
 *
 * vibers.tv has no chat server — the wall itself is localStorage (see
 * `lib/stream.ts`), and this is the same deal: a message you send is stored in
 * *your* browser under the video it belongs to, and it is never sent anywhere.
 * That is stated in the panel rather than dressed up, and it is why nothing
 * here invents a participant, a viewer count, or a message.
 *
 * Everything in this file is a pure function or a thin wrapper over one
 * `Storage`, so all of it is testable without a DOM. The store takes its
 * `Storage` as an argument — defaulting to the real `localStorage` — and
 * guards on `typeof localStorage`, not `typeof window`, so it behaves the same
 * under vitest's node environment as it does in the browser.
 */

export interface ChatMessage {
  id: string;
  handle: string;
  body: string;
  /** Epoch ms, stamped when the message is sent. Never read during render. */
  sentAt: number;
}

/** The two halves of the panel: YouTube's real chat, and your own notes. */
export type ChatTab = "live" | "notes";

/**
 * Which tab the panel opens on.
 *
 * Only a stream we have *confirmed* is not live opens on the notes. Unknown
 * opens on the chat, and that asymmetry is deliberate: `isLive` is only ever
 * true when the Data API said so, which needs `YOUTUBE_API_KEY` — so without
 * a key every stream reads `undefined`, and treating unknown as "not live"
 * would hide the live chat on every video the site has. On something with no
 * chat, YouTube's own frame says so accurately; that is a better failure than
 * a feature nobody can find.
 */
export function initialTab(isLive?: boolean): ChatTab {
  return isLive === false ? "notes" : "live";
}

export const MAX_BODY = 400;
export const MAX_HANDLE = 24;
/** Oldest messages fall off the top past this. A transcript, not an archive. */
export const MAX_MESSAGES = 200;

const CHAT_PREFIX = "vibers:chat:";
const HANDLE_KEY = "vibers:handle";

export function chatKey(videoId: string): string {
  return CHAT_PREFIX + videoId;
}

/** True for the keys this module owns — used to filter `storage` events. */
export function isChatKey(key: string | null, videoId: string): boolean {
  // `key` is null when another tab called `localStorage.clear()`, which wipes
  // this video's transcript too, so that counts as a change worth reloading.
  return key === null || key === chatKey(videoId);
}

function store(explicit?: Storage): Storage | null {
  if (explicit) return explicit;
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

/**
 * Anything in localStorage is user-editable, so a stored transcript is treated
 * as hostile input: every message is shape-checked and anything malformed is
 * dropped rather than crashing the panel.
 */
export function parseMessages(raw: string | null): ChatMessage[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isMessage).slice(-MAX_MESSAGES);
}

function isMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.handle === "string" &&
    typeof m.body === "string" &&
    typeof m.sentAt === "number" &&
    Number.isFinite(m.sentAt)
  );
}

/** Oldest first, capped from the top so the newest message always survives. */
export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
}

export function listMessages(videoId: string, storage?: Storage): ChatMessage[] {
  const s = store(storage);
  if (!s) return [];
  try {
    return parseMessages(s.getItem(chatKey(videoId)));
  } catch {
    return [];
  }
}

export interface SendResult {
  ok: boolean;
  messages: ChatMessage[];
  /** Set when the message could not be stored — shown in the composer. */
  error?: string;
}

/**
 * `id` and `sentAt` are injected rather than minted here so the whole path is
 * deterministic under test; the composer passes the real ones.
 */
export function sendMessage(
  videoId: string,
  draft: { handle: string; body: string; id: string; sentAt: number },
  storage?: Storage,
): SendResult {
  const body = normalizeBody(draft.body);
  const handle = normalizeHandle(draft.handle);
  const existing = listMessages(videoId, storage);
  if (!body) return { ok: false, messages: existing, error: "Type something first." };

  const next = trimHistory([...existing, { id: draft.id, handle, body, sentAt: draft.sentAt }]);
  const s = store(storage);
  if (!s) return { ok: false, messages: existing, error: "This browser has no storage." };
  try {
    s.setItem(chatKey(videoId), JSON.stringify(next));
  } catch {
    // A swallowed send is worse than a failed one — the message would just
    // vanish. Say so instead.
    return { ok: false, messages: existing, error: "Storage is full — that one wasn't kept." };
  }
  return { ok: true, messages: next };
}

/** Called when a stream leaves the wall, so its transcript doesn't outlive it. */
export function clearMessages(videoId: string, storage?: Storage): void {
  const s = store(storage);
  if (!s) return;
  try {
    s.removeItem(chatKey(videoId));
  } catch {
    // Nothing to do — the transcript simply stays.
  }
}

export function normalizeBody(body: string): string {
  // Newlines collapse: the composer is one line, and a pasted block would
  // otherwise stretch the transcript arbitrarily.
  return body.replace(/\s+/g, " ").trim().slice(0, MAX_BODY);
}

export function normalizeHandle(handle: string): string {
  const cleaned = handle.replace(/\s+/g, "").slice(0, MAX_HANDLE);
  return cleaned || "anon";
}

/**
 * The wall clock a message carries. This codebase speaks in timecodes rather
 * than "3 minutes ago", and a fixed stamp also means no ticking clock and no
 * `Date.now()` anywhere near a render.
 */
export function stamp(sentAt: number): string {
  const d = new Date(sentAt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A handle to start from, minted once per browser and then kept. */
export function loadHandle(storage?: Storage): string | null {
  const s = store(storage);
  if (!s) return null;
  try {
    const raw = s.getItem(HANDLE_KEY);
    return raw ? normalizeHandle(raw) : null;
  } catch {
    return null;
  }
}

export function saveHandle(handle: string, storage?: Storage): void {
  const s = store(storage);
  if (!s) return;
  try {
    s.setItem(HANDLE_KEY, normalizeHandle(handle));
  } catch {
    // Private browsing — the handle just won't survive the session.
  }
}

/** `seed` is a random draw, passed in so the mint itself stays pure. */
export function mintHandle(seed: number): string {
  const n = Math.abs(Math.floor(seed * 10000)) % 10000;
  return `viber-${String(n).padStart(4, "0")}`;
}

/* ------------------------------------------------------------------ *
 * Signing in to post
 * ------------------------------------------------------------------ */

/**
 * Posting to a stream's chat needs a YouTube account, and a YouTube sign-in
 * only completes in a **top-level window** — `accounts.google.com` answers
 * `X-Frame-Options: DENY`, so the *Sign in* button inside the embedded chat
 * cannot ever work. `liveChatSignInUrl` in `lib/youtube.ts` builds the URL; the
 * few functions here are the part with the sharp edges, kept out of the
 * component so they can be tested without a DOM.
 *
 * The window is opened through an injected `open` for exactly the reason the
 * store takes its `Storage`: popup blocking and adblocker stubs are the states
 * worth testing, and neither is reachable from vitest's node environment.
 */

/** Where the flow is. Nothing here ever means "signed in" — see `pollSignIn`. */
export type SignInPhase = "idle" | "waiting" | "blocked" | "returned" | "unreadable";

/** The sliver of `Window` this flow touches, so a test can stand one up. */
export interface SignInWindow {
  readonly closed: boolean;
  focus(): void;
}

/** `window.open`, narrowed to what is used and injectable. */
export type OpenWindow = (url: string, target: string, features: string) => SignInWindow | null;

/**
 * One name for the window. A second click then refocuses the sign-in already
 * open instead of stacking another one behind it — which matters here, because
 * a duplicate window would also restart a half-typed sign-in.
 */
export const SIGN_IN_WINDOW_NAME = "vibers-live-chat";

/**
 * Sized like a chat column rather than a browser. `popup=yes` is what asks for
 * a window instead of a tab — phones ignore it and open a tab, which is fine.
 *
 * `noopener` must never appear here: it nulls the returned handle, and the
 * handle is the only way to notice the viewer coming back.
 */
export const SIGN_IN_WINDOW_FEATURES = "popup=yes,width=460,height=700";

export type SignInOpened = { phase: "waiting"; window: SignInWindow } | { phase: "blocked" };

/**
 * Ask for the window. `null` is a popup blocker; a handle that is *already*
 * closed is an extension's stub — neither is a window the viewer can sign into,
 * so both land on `blocked`, where the panel points at the plain link instead.
 */
export function openSignIn(url: string, open: OpenWindow): SignInOpened {
  let win: SignInWindow | null;
  try {
    win = open(url, SIGN_IN_WINDOW_NAME, SIGN_IN_WINDOW_FEATURES);
  } catch {
    return { phase: "blocked" };
  }
  if (!win || win.closed) return { phase: "blocked" };
  try {
    // Refocusing a window that is already open is the whole point of naming it.
    win.focus();
  } catch {
    // A handle we may not touch still counts as opened — don't fail the flow.
  }
  return { phase: "waiting", window: win };
}

/** `closed` on a severed handle can throw; unreadable is treated as gone. */
export function readClosed(win: SignInWindow): boolean {
  try {
    return win.closed;
  } catch {
    return true;
  }
}

export const SIGN_IN_POLL_MS = 500;

/**
 * How soon a "closed" window is disbelieved.
 *
 * Google's sign-in page sends `Cross-Origin-Opener-Policy-Report-Only:
 * same-origin` (probed 2026-07-27). Report-only is the step before enforcing,
 * and on the day it enforces, navigating there severs the browsing-context
 * group and our handle starts reporting `closed === true` immediately — while
 * the viewer is still typing their password. A close that fast is therefore
 * read as *we cannot tell*, never as *they came back*.
 */
export const SIGN_IN_GRACE_MS = 1_500;

/** A window nobody closed is not worth polling forever. */
export const SIGN_IN_LIMIT_MS = 5 * 60_000;

/**
 * One tick of the watch on the sign-in window.
 *
 * The outcome is deliberately weak: cross-origin, the *only* readable fact is
 * whether the handle still points at an open window. Whether anyone signed in,
 * and whether that account even has a channel to post from, are both invisible
 * from here — so `returned` means "that window closed", not "you are signed
 * in", and the panel's copy is written to match.
 */
export function pollSignIn(closed: boolean, elapsedMs: number): SignInPhase {
  if (closed) return elapsedMs < SIGN_IN_GRACE_MS ? "unreadable" : "returned";
  return elapsedMs >= SIGN_IN_LIMIT_MS ? "unreadable" : "waiting";
}

/** True once the sign-in window is done with — the frame may be worth a reload. */
export function canReloadChat(phase: SignInPhase): boolean {
  return phase === "returned" || phase === "unreadable";
}
