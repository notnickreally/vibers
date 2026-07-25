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
