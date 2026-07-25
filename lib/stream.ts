/**
 * The wall's contents. Every field here comes from YouTube — nothing on
 * vibers.tv is invented about a stream or its creator.
 *
 * There is no database yet, so the wall lives in localStorage: it's yours, it
 * persists across visits, and it does not sync between devices.
 */

import { clearMessages } from "./chat";

export interface Stream {
  videoId: string;
  title: string;
  channel: string;
  channelUrl?: string;
  thumbnail: string;
  description?: string;
  /** Only set when the Data API confirmed it. Absent means "we don't know". */
  isLive?: boolean;
  viewers?: number;
  /** Epoch ms, stamped client-side when added. Never read during render. */
  addedAt: number;
}

export interface Metadata extends Omit<Stream, "addedAt"> {}

const KEY = "vibers:wall";
const MAX = 60;

export async function lookup(input: string): Promise<Metadata> {
  const res = await fetch(`/api/youtube?v=${encodeURIComponent(input)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Lookup failed.");
  return data as Metadata;
}

export function listStreams(): Stream[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Stream[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addStream(meta: Metadata): Stream[] {
  const stream: Stream = { ...meta, addedAt: Date.now() };
  const next = [stream, ...listStreams().filter((s) => s.videoId !== meta.videoId)].slice(0, MAX);
  write(next);
  return next;
}

export function removeStream(videoId: string): Stream[] {
  // A stream's chat is stored under its own key, so taking it off the wall has
  // to take the transcript with it — otherwise the keys accumulate forever.
  clearMessages(videoId);
  const next = listStreams().filter((s) => s.videoId !== videoId);
  write(next);
  return next;
}

export function findStream(videoId: string): Stream | undefined {
  return listStreams().find((s) => s.videoId === videoId);
}

function write(streams: Stream[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(streams));
  } catch {
    // Private browsing — the wall just won't survive the session.
  }
}

export const RIGHTS_CONTACT = "rights@vibers.tv";
