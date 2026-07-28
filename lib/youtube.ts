/**
 * A run's picture comes from a YouTube URL the viber pastes in — a live stream,
 * a premiere, or a recorded VOD. Everything YouTube hands out is accepted:
 * watch links, share links, /live/, /embed/, /shorts/, or a bare video id.
 */

const ID = /^[A-Za-z0-9_-]{11}$/;

/** A bare video id, and nothing else. The gate on anything we hand upstream. */
export function isVideoId(input: string): boolean {
  return ID.test(input);
}

/**
 * The `?ids=` parameter of the status route, turned into ids we're willing to
 * send to Google.
 *
 * Everything here is a security control rather than a convenience: the ids are
 * interpolated into an upstream URL, so anything that isn't recognisably a
 * video id is dropped rather than escaped. Duplicates are collapsed so a
 * hostile caller can't spend the day's quota on one repeated id, and the cap
 * is `videos.list`'s own limit — asking for more than 50 is an error upstream,
 * not a bigger answer.
 */
export const MAX_IDS = 50;

export function parseIds(input: string | null, cap: number = MAX_IDS): string[] {
  if (!input) return [];
  const out: string[] = [];
  for (const part of input.split(",")) {
    const id = part.trim();
    if (!ID.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Ids in batches `videos.list` will accept.
 *
 * Deliberately not `parseIds`' job. That function is a security gate and its cap
 * is the upstream limit, so asking it to also size the batches makes one number
 * do two jobs — and the day the candidate set is larger than one batch, the gate
 * silently drops the overflow instead of the batcher splitting it. Two numbers,
 * two functions.
 */
export function chunk<T>(items: T[], size: number = MAX_IDS): T[][] {
  if (size < 1) return [];
  const out: T[][] = [];
  for (let i = 0; i < (items?.length ?? 0); i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The shape of a `videos.list` item, as much of it as liveness depends on. */
export interface VideoItem {
  id?: string;
  snippet?: { liveBroadcastContent?: string };
  liveStreamingDetails?: { actualStartTime?: string; actualEndTime?: string };
}

/**
 * Is this video on air right now? — the one answer, in one place.
 *
 * There used to be two spellings of this, one in `/api/youtube` and one in
 * `/api/youtube/status`, both reading `liveBroadcastContent === "live"` and no
 * `actualEndTime`. Discovery would have made a third, and a stream confirmed
 * live by one rule can then be re-judged by another seconds later — which is
 * how a tile ends up flickering between shelves. So all three call this.
 *
 * The two extra clauses over the old rule are not decoration:
 *
 * - **`liveStreamingDetails` must exist at all.** YouTube only carries it for
 *   something that was once a broadcast, so its absence is what separates a
 *   plain uploaded video from a stream — the distinction the wall's `cardState`
 *   already depends on.
 * - **`actualStartTime` must be present.** It "will not be available until the
 *   broadcast begins", so it is the field that rules out a scheduled premiere
 *   that has not started. `liveBroadcastContent` reports those as `upcoming`,
 *   but only until the moment the index disagrees with the resource.
 */
export function isLive(item: VideoItem | undefined): boolean {
  const details = item?.liveStreamingDetails;
  if (!details?.actualStartTime || details.actualEndTime) return false;
  return item?.snippet?.liveBroadcastContent === "live";
}

/**
 * A URL safe to put in an `href`, or null.
 *
 * The wall lives in localStorage, which is the user's own to edit, so a stored
 * `channelUrl` is not automatically the `https://youtube.com/@…` that oEmbed
 * handed us — it is whatever is in the store by the time it is read. Only
 * http(s) survives, which is what keeps a hand-edited `javascript:` out of the
 * link. Self-inflicted either way (nothing here is shared), but a link is a
 * link and this is one line.
 */
export function safeHttpUrl(input: string | undefined): string | null {
  if (!input) return null;
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export interface YouTubeSource {
  id: string;
  /** Seconds to start at, if the URL carried a timestamp. */
  start?: number;
}

function parseStart(value: string | null): number | undefined {
  if (!value) return undefined;
  // YouTube writes timestamps as either "90" or "1h2m30s".
  if (/^\d+$/.test(value)) return Number(value);
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m?.[0]) return undefined;
  const [, h, min, s] = m;
  const total = Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
  return total > 0 ? total : undefined;
}

/** Returns null for anything that isn't recognisably a YouTube video. */
export function parseYouTube(input: string): YouTubeSource | null {
  const raw = input.trim();
  if (!raw) return null;
  if (ID.test(raw)) return { id: raw };

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const start = parseStart(url.searchParams.get("t") ?? url.searchParams.get("start"));
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    const id = segments[0];
    return id && ID.test(id) ? { id, start } : null;
  }

  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;

  const v = url.searchParams.get("v");
  if (v && ID.test(v)) return { id: v, start };

  // /live/ID, /embed/ID, /shorts/ID, /v/ID
  if (["live", "embed", "shorts", "v"].includes(segments[0])) {
    const id = segments[1];
    if (id && ID.test(id)) return { id, start };
  }

  return null;
}

/** Privacy-preserving embed URL. Autoplay only works muted, so it starts muted. */
export function embedUrl(source: YouTubeSource, { autoplay = true } = {}): string {
  const params = new URLSearchParams({
    autoplay: autoplay ? "1" : "0",
    mute: autoplay ? "1" : "0",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
  });
  if (source.start) params.set("start", String(source.start));
  return `https://www.youtube-nocookie.com/embed/${source.id}?${params}`;
}

export function watchUrl(source: YouTubeSource): string {
  return `https://www.youtube.com/watch?v=${source.id}`;
}

/**
 * The stream's own live chat, as a framable document.
 *
 * Three things about this endpoint are load-bearing and none of them are
 * obvious, so they are written down rather than rediscovered:
 *
 * 1. It is served from `www.youtube.com` only. `youtube-nocookie.com` — which
 *    every other embed here uses — does not carry it.
 * 2. `embed_domain` is the whole gate. YouTube answers with
 *    `X-Frame-Options: SAMEORIGIN` unless it matches the parent page's
 *    Referer hostname *exactly*: hostname only, no scheme, no port, and
 *    `www.` is not normalised away. `window.location.hostname` is precisely
 *    that string, which is why this takes a hostname and not a URL.
 * 3. The Referer header is the only signal YouTube reads. A page that sends
 *    none — `Referrer-Policy: no-referrer`, or a `referrerpolicy` on the
 *    frame — is refused even with a correct `embed_domain`. See the frame in
 *    `components/chat/live-chat.tsx`.
 *
 * Returns null rather than a URL that would load a refusal, so the caller has
 * something to branch on. Verified against www.youtube.com, 2026-07-27.
 */
export function liveChatUrl(videoId: string, embedDomain: string): string | null {
  if (!ID.test(videoId)) return null;
  const host = normalizeEmbedDomain(embedDomain);
  if (!host) return null;

  const params = new URLSearchParams({
    v: videoId,
    embed_domain: host,
    // Undocumented, but currently honoured — it puts `dark` on the chat
    // document's own <html>. Light is the default, and light chat inside an
    // aubergine panel is the one outcome worse than no chat. If YouTube ever
    // drops it the panel still works; it just stops matching.
    dark_theme: "1",
  });
  return `https://www.youtube.com/live_chat?${params}`;
}

/**
 * The pop-out chat, for the escape hatch under the frame.
 *
 * `live_chat?v=…` alone does not stand up as a top-level page; `is_popout=1`
 * is what makes it one. Deliberately not `watchUrl` — that link already
 * exists next to the player, and someone clicking this one wants the chat.
 */
export function liveChatPopoutUrl(videoId: string): string | null {
  if (!ID.test(videoId)) return null;
  const params = new URLSearchParams({ v: videoId, is_popout: "1" });
  return `https://www.youtube.com/live_chat?${params}`;
}

/**
 * The sign-in that ends in *this stream's* chat, ready to post.
 *
 * Posting needs a YouTube account, and a YouTube sign-in can only happen in a
 * top-level window — `accounts.google.com` answers `X-Frame-Options: DENY`, so
 * the **Sign in** button inside the framed chat above is a dead end no matter
 * what we do out here. This is the URL the panel opens in a real window.
 *
 * It is YouTube's own redirector rather than a hand-built `accounts.google.com`
 * URL, and that is the whole point of it existing:
 *
 * - YouTube mints the Gaia URL, so the half-dozen parameters that make the
 *   flow work (`service`, `uilel`, `flowName`, …) are theirs to keep correct.
 * - It sets `passive=true`, so someone already signed in is waved straight
 *   through to the chat instead of being asked to log in again.
 * - The return trip runs back through `youtube.com/signin?action_handle_signin`,
 *   which is what establishes the *YouTube* session — not merely the Google
 *   one. A `continue=` pointed straight at the chat skips that step.
 *
 * `next` is same-origin and relative on purpose: YouTube only honours its own
 * paths there, and a relative one is also the only kind that can't be turned
 * into an open redirect by whatever ends up calling this.
 *
 * Verified against www.youtube.com, 2026-07-27: `303` → `ServiceLogin?…
 * passive=true…continue=…%2Fsignin%3Faction_handle_signin%3Dtrue…`.
 */
export function liveChatSignInUrl(videoId: string): string | null {
  if (!ID.test(videoId)) return null;
  const next = `/live_chat?${new URLSearchParams({ v: videoId, is_popout: "1" })}`;
  return `https://www.youtube.com/signin?${new URLSearchParams({ next })}`;
}

/** Hostnames YouTube will compare against: letters, digits, dots, hyphens. */
const HOSTNAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;

/**
 * A bare hostname, or null.
 *
 * A trailing `:port` is dropped — `localhost:3000` is a perfectly ordinary
 * dev origin and YouTube matches it as `localhost`. Everything else that
 * isn't already a hostname is rejected rather than salvaged: a scheme is not
 * a host with a funny port, and guessing at one would hand YouTube a string
 * that quietly fails the match.
 */
export function normalizeEmbedDomain(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw || /[/@?#\s]/.test(raw)) return null;

  const parts = raw.split(":");
  if (parts.length > 2) return null;
  // `https:example.com` splits like a port but isn't one.
  if (parts.length === 2 && !/^\d+$/.test(parts[1])) return null;

  const host = parts[0];
  // 253 is the DNS limit; the rest keeps a stray dot from passing the regex.
  if (!host || host.length > 253 || !HOSTNAME.test(host)) return null;
  return host;
}

/** Poster frame, used before the player mounts and in the go-live preview. */
export function thumbnailUrl(source: YouTubeSource): string {
  return `https://i.ytimg.com/vi/${source.id}/hqdefault.jpg`;
}

/**
 * The poster that stands in for the picture until there is one.
 *
 * Variant matters more than it looks. `maxresdefault` is missing for most live
 * streams and 404s on the critical path; `hqdefault` exists everywhere but is
 * 480×360 with 4:3 pillarbox bars *baked into the image*, so it cannot be
 * dropped into a 16:9 box. `hq720` is a true 16:9 frame, and `mqdefault` is
 * the 16:9 variant that always exists — so: try one, fall back to the other.
 *
 * Checked against i.ytimg.com rather than assumed: `hq720` is a 200 for
 * `dQw4w9WgXcQ` and a 404 for `jNQXAC9IVRw`, while `mqdefault` is a 200 for
 * both. The fallback is load-bearing, not defensive.
 */
export function posterUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hq720.jpg`;
}

/** The 16:9 poster that is always present, for when `posterUrl` 404s. */
export function posterFallbackUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

const KEY_PREFIX = "vibers:stream:";

export function loadSource(handle: string): YouTubeSource | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + handle);
    return raw ? (JSON.parse(raw) as YouTubeSource) : null;
  } catch {
    return null;
  }
}

export function saveSource(handle: string, source: YouTubeSource | null): void {
  if (typeof window === "undefined") return;
  try {
    if (source) window.localStorage.setItem(KEY_PREFIX + handle, JSON.stringify(source));
    else window.localStorage.removeItem(KEY_PREFIX + handle);
  } catch {
    // Private browsing — the source just won't persist past this page.
  }
}
