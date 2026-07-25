import type { Relay } from "@/lib/mock/types";
import type { YouTubeSource } from "@/lib/youtube";

/**
 * Relays have no server, so they live in two places: the link itself (so a relay
 * can be shared) and localStorage (so yours come back when you return).
 *
 * Only `videoId` is ever required. Empty optional fields stay empty — a relay
 * never invents a goal, a tool or a stack to fill space, because inventing
 * those about someone else's stream is the one thing this surface must not do.
 */

const KEY = "vibers:relays";
const MAX = 40;

export function relayToQuery(relay: Relay): string {
  const q = new URLSearchParams();
  if (relay.title) q.set("t", relay.title);
  if (relay.note) q.set("n", relay.note);
  if (relay.tool) q.set("tool", relay.tool);
  if (relay.stacks?.length) q.set("stack", relay.stacks.join(","));
  if (relay.relayedBy) q.set("by", relay.relayedBy);
  if (relay.start) q.set("s", String(relay.start));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function relayHref(relay: Relay): string {
  return `/relay/${relay.videoId}${relayToQuery(relay)}`;
}

type ParamBag = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

export function relayFromParams(videoId: string, params: ParamBag): Relay {
  const stack = one(params.stack);
  const start = one(params.s);
  return {
    videoId,
    title: one(params.t),
    note: one(params.n),
    tool: one(params.tool),
    stacks: stack
      ? stack
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    relayedBy: one(params.by),
    start: start && /^\d+$/.test(start) ? Number(start) : undefined,
  };
}

/**
 * A relay keys its video as `videoId` because that is what it is to the rest of
 * the app; the player wants a `YouTubeSource`. Convert explicitly rather than
 * making one type quietly satisfy the other.
 */
export function relaySource(relay: Relay): YouTubeSource {
  return { id: relay.videoId, start: relay.start };
}

/** True when the relay carries nothing but the video — the default, and fine. */
export function isBare(relay: Relay): boolean {
  return !relay.title && !relay.note && !relay.tool && !relay.stacks?.length;
}

// --- local list ------------------------------------------------------------

export function listRelays(): Relay[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Relay[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRelay(relay: Relay): Relay[] {
  const next = [relay, ...listRelays().filter((r) => r.videoId !== relay.videoId)].slice(0, MAX);
  write(next);
  return next;
}

export function removeRelay(videoId: string): Relay[] {
  const next = listRelays().filter((r) => r.videoId !== videoId);
  write(next);
  return next;
}

export function findRelay(videoId: string): Relay | undefined {
  return listRelays().find((r) => r.videoId === videoId);
}

function write(relays: Relay[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(relays));
  } catch {
    // Private browsing — relays just won't survive the tab.
  }
}
