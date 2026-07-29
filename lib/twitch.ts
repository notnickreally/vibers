/**
 * Twitch, the wall's second source.
 *
 * Everything here is the Twitch half of what `lib/youtube.ts` does for YouTube:
 * turn a pasted link into something we can store, and turn what we stored back
 * into an embed, a poster and a link out. `lib/source.ts` is the seam that
 * picks between the two — nothing outside it should be asking "which one is
 * this?" by hand.
 *
 * Three things about Twitch are different enough from YouTube to be worth
 * stating before any of the code below makes sense.
 *
 * **A Twitch stream has no video id.** What is on air on a channel right now is
 * addressed by the *channel*, not by the broadcast — `twitch.tv/someone` is the
 * live URL forever, and the thing playing behind it changes. So a live Twitch
 * entry on the wall is a channel login, and it is the one kind of wall entry
 * whose *content* is allowed to change under it. VODs (`/videos/<id>`) and
 * clips do have their own ids and behave like YouTube videos.
 *
 * **`parent` is the whole gate on framing.** `player.twitch.tv` and
 * `twitch.tv/embed/…/chat` both answer `Content-Security-Policy:
 * frame-ancestors <your parent>` — and, with no `parent` at all, a redirect and
 * `X-Frame-Options: SAMEORIGIN`. It is the same bargain YouTube's `live_chat`
 * makes through `embed_domain`, so it takes the same input: a bare hostname,
 * which is exactly `window.location.hostname`. Verified against
 * player.twitch.tv and www.twitch.tv, 2026-07-28.
 *
 * **A login is not a display name.** `twitch.tv/theprimeagen` is the login;
 * "ThePrimeagen" is what the channel calls itself. The login is what we key on
 * and what every URL here is built from; the display name is looked up (see
 * `lib/twitch-lookup.ts`) and only ever shown.
 */

/**
 * What a Twitch link resolves to.
 *
 * `channel` is a live channel — whatever it is broadcasting. `video` is a VOD,
 * `clip` is a clip. They are separate because each takes a different embed
 * parameter, and only `channel` has a chat to carry.
 */
export type TwitchKind = "channel" | "video" | "clip";

export interface TwitchSource {
  kind: TwitchKind;
  /** Login for `channel`, VOD id for `video`, slug for `clip`. */
  id: string;
  /** Seconds to start at, if the URL carried a timestamp. VODs only. */
  start?: number;
}

/** Twitch logins: letters, digits and underscores. Case is not significant. */
const LOGIN = /^[a-z0-9_]{1,25}$/;
/** VOD ids are decimal, and Twitch writes them with or without a leading `v`. */
const VIDEO = /^\d{1,15}$/;
/** Clip slugs are word-ish, and the modern ones carry a `-<random>` suffix. */
const CLIP = /^[A-Za-z0-9]{2,80}(?:-[A-Za-z0-9_-]{1,60})?$/;

/**
 * First path segments that are Twitch's own, not somebody's channel.
 *
 * `twitch.tv/directory` is a page; `twitch.tv/directory` is not a viber. Without
 * this list every one of Twitch's own routes parses as a perfectly valid channel
 * login and goes up on the wall as a tile that will never have a picture. It
 * does not need to be exhaustive to be worth having — it covers what someone is
 * plausibly pasting from the address bar.
 */
const RESERVED = new Set([
  "directory",
  "downloads",
  "drops",
  "friends",
  "inventory",
  "jobs",
  "login",
  "moderator",
  "p",
  "payments",
  "popout",
  "prime",
  "products",
  "search",
  "settings",
  "signup",
  "store",
  "subs",
  "team",
  "turbo",
  "wallet",
]);

/**
 * Twitch's timestamps are `1h2m3s`, and always at least one unit.
 *
 * Deliberately not `lib/youtube.ts`'s `parseStart`: YouTube also accepts a bare
 * number of seconds (`?t=90`) and Twitch does not, so sharing one parser would
 * mean quietly accepting on one platform a spelling the other rejects.
 */
function parseStart(value: string | null): number | undefined {
  if (!value) return undefined;
  const m = value.trim().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m?.[0]) return undefined;
  const [, h, min, s] = m;
  const total = Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
  return total > 0 ? total : undefined;
}

/** `1h2m3s` — the only spelling the Twitch player's `time=` accepts. */
export function formatStart(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${h}h${m}m${s}s`;
}

function video(raw: string, start?: number): TwitchSource | null {
  // `/videos/12345` and the older `/<login>/v/12345` both name the same VOD.
  const id = raw.replace(/^v/i, "");
  return VIDEO.test(id) ? { kind: "video", id, start } : null;
}

/**
 * Returns null for anything that isn't recognisably a Twitch stream, VOD or clip.
 *
 * Accepts what Twitch itself hands out — the address bar, the Share sheet, the
 * mobile host, the embed URLs — plus a bare `twitch.tv/login`, which is what
 * people actually type. It does **not** accept a bare login on its own: `nasa`
 * is a Twitch channel and also eleven other things, and a wall that guessed
 * would put the wrong one up.
 */
export function parseTwitch(input: string): TwitchSource | null {
  const raw = input.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  const start = parseStart(url.searchParams.get("t") ?? url.searchParams.get("time"));

  // The embed player addresses everything by query parameter, so it is read
  // before any path: `player.twitch.tv/` has no path at all.
  if (host === "player.twitch.tv") {
    const channel = url.searchParams.get("channel");
    if (channel) return channel_(channel);
    const id = url.searchParams.get("video");
    if (id) return video(id, start);
    return null;
  }

  if (host === "clips.twitch.tv") {
    // `clips.twitch.tv/<slug>` and `clips.twitch.tv/embed?clip=<slug>`.
    const slug = segments[0] === "embed" ? url.searchParams.get("clip") : segments[0];
    return slug && CLIP.test(slug) ? { kind: "clip", id: slug } : null;
  }

  if (host !== "twitch.tv") return null;

  const [first, second, third] = segments;
  if (!first) return null;

  // `/videos/<id>`
  if (first === "videos") return second ? video(second, start) : null;
  // `/embed/<login>/chat` — someone copying the chat frame's own URL.
  if (first === "embed") return second ? channel_(second) : null;

  if (RESERVED.has(first.toLowerCase())) return null;

  // `/<login>/v/<id>`, `/<login>/video/<id>`, `/<login>/clip/<slug>`
  if (second === "v" || second === "video") return third ? video(third, start) : null;
  if (second === "clip") return third && CLIP.test(third) ? { kind: "clip", id: third } : null;

  // `/<login>` — and only `/<login>`. A deeper path is one of Twitch's own
  // pages (`/<login>/about`, `/<login>/schedule`), not the stream.
  return segments.length === 1 ? channel_(first) : null;
}

function channel_(raw: string): TwitchSource | null {
  const login = raw.trim().toLowerCase();
  return LOGIN.test(login) ? { kind: "channel", id: login } : null;
}

/* ---------------------------------------------------------------------------
   Wall keys.

   The wall stores one string per entry and has done since it was a browser
   store, so Twitch entries carry their provider in that string rather than in
   a column nothing else reads. `twitch:channel:someone`. A bare YouTube id has
   no prefix, which is what keeps every row already in Neon — and every
   `/watch/<id>` link already out in the world — meaning exactly what it did.
--------------------------------------------------------------------------- */

export const TWITCH_PREFIX = "twitch:";

/** The wall's key for a Twitch source. Round-trips through `parseTwitchKey`. */
export function twitchKey(source: TwitchSource): string {
  return `${TWITCH_PREFIX}${source.kind}:${source.id}`;
}

export function isTwitchKey(key: string): boolean {
  return typeof key === "string" && key.startsWith(TWITCH_PREFIX);
}

/**
 * A stored key, back into a source — or null.
 *
 * Validated rather than trusted, and for the same reason `safeHttpUrl` exists:
 * these ids are interpolated into embed URLs and into Helix requests, and the
 * key travels through a shared database and a URL path on the way here. A key
 * that doesn't parse is a tile that says so, not a request built from it.
 *
 * The timestamp is deliberately not carried: what a stored key names is a
 * broadcast, a VOD or a clip, and the second someone happened to link to is a
 * property of the link, not of the thing on the wall.
 */
export function parseTwitchKey(key: string): TwitchSource | null {
  if (!isTwitchKey(key)) return null;
  const rest = key.slice(TWITCH_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut < 1) return null;
  const kind = rest.slice(0, cut);
  const id = rest.slice(cut + 1);
  if (kind === "channel") return channel_(id);
  if (kind === "video") return VIDEO.test(id) ? { kind: "video", id } : null;
  if (kind === "clip") return CLIP.test(id) ? { kind: "clip", id } : null;
  return null;
}

/* ---------------------------------------------------------------------------
   URLs.

   Every one of these takes the parent hostname where framing needs it, and
   returns null rather than a URL that would load a refusal — so the caller has
   something to branch on instead of an empty rectangle.
--------------------------------------------------------------------------- */

/** Hostnames Twitch will compare against: letters, digits, dots, hyphens. */
const HOSTNAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;

/**
 * A bare hostname for `parent=`, or null.
 *
 * Same shape as `normalizeEmbedDomain` in `lib/youtube.ts` and the same input —
 * `window.location.hostname` — but a separate function on purpose: the two
 * platforms are free to differ about ports and about `www.`, and one shared
 * normaliser would make a change for one silently a change for both. Twitch's
 * `frame-ancestors` for `parent=localhost` comes back as `http://localhost:*`,
 * so the port is genuinely not ours to send.
 */
export function normalizeParent(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw || /[/@?#\s]/.test(raw)) return null;
  const parts = raw.split(":");
  if (parts.length > 2) return null;
  if (parts.length === 2 && !/^\d+$/.test(parts[1])) return null;
  const host = parts[0];
  if (!host || host.length > 253 || !HOSTNAME.test(host)) return null;
  return host;
}

interface EmbedOptions {
  autoplay?: boolean;
  muted?: boolean;
  /** Twitch's own control bar. Off for wall tiles, on for the watch player. */
  controls?: boolean;
}

/**
 * The embed for a source, framed under `parent`.
 *
 * Clips live on a different host from streams and VODs — `clips.twitch.tv/embed`
 * rather than `player.twitch.tv` — which is Twitch's arrangement, not ours.
 */
export function twitchEmbedUrl(
  source: TwitchSource,
  parent: string,
  { autoplay = true, muted = true, controls = false }: EmbedOptions = {},
): string | null {
  const host = normalizeParent(parent);
  if (!host) return null;

  const params = new URLSearchParams({
    parent: host,
    autoplay: autoplay ? "true" : "false",
    muted: muted ? "true" : "false",
  });

  if (source.kind === "clip") {
    params.set("clip", source.id);
    return `https://clips.twitch.tv/embed?${params}`;
  }

  params.set("controls", controls ? "true" : "false");
  if (source.kind === "channel") params.set("channel", source.id);
  else {
    params.set("video", source.id);
    if (source.start) params.set("time", formatStart(source.start));
  }
  return `https://player.twitch.tv/?${params}`;
}

/**
 * The channel's own chat, as a framable document.
 *
 * Only a channel has one. A VOD's chat is a replay Twitch renders inside its own
 * player rather than a document we can frame, and a clip has none at all — so
 * this returns null for both, and the panel says why instead of showing a
 * rectangle that will never fill.
 *
 * `darkpopout` is Twitch's own parameter for the dark theme, the counterpart of
 * the `dark_theme=1` the YouTube chat frame carries.
 */
export function twitchChatUrl(source: TwitchSource, parent: string): string | null {
  if (source.kind !== "channel") return null;
  const host = normalizeParent(parent);
  if (!host) return null;
  const params = new URLSearchParams({ parent: host, darkpopout: "" });
  return `https://www.twitch.tv/embed/${source.id}/chat?${params}`;
}

/** The pop-out chat, for the escape hatch under the frame. */
export function twitchChatPopoutUrl(source: TwitchSource): string | null {
  return source.kind === "channel" ? `https://www.twitch.tv/popout/${source.id}/chat` : null;
}

/** Where this lives on Twitch. */
export function twitchWatchUrl(source: TwitchSource): string {
  if (source.kind === "channel") return `https://www.twitch.tv/${source.id}`;
  if (source.kind === "video") return `https://www.twitch.tv/videos/${source.id}`;
  return `https://clips.twitch.tv/${source.id}`;
}

/**
 * The poster that stands in for the picture until there is one.
 *
 * Only a live channel has a predictable one, and it is a real, keyless URL:
 * Twitch keeps the current frame of every live channel at
 * `previews-ttv/live_user_<login>-<size>.jpg`. An offline or unknown channel
 * redirects to Twitch's own 404 preview — still a 16:9 image, so the tile is a
 * picture either way rather than a hole.
 *
 * A VOD and a clip have thumbnails too, but only ones the API hands out, so they
 * come back through the lookup with everything else and there is nothing to
 * guess here. Checked against static-cdn.jtvnw.net, 2026-07-28.
 */
export function twitchPosterUrl(source: TwitchSource): string {
  if (source.kind !== "channel") return TWITCH_NO_PREVIEW;
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${source.id}-1280x720.jpg`;
}

/** Twitch's own "nothing to show" frame — what the preview URL redirects to. */
export const TWITCH_NO_PREVIEW = "https://static-cdn.jtvnw.net/ttv-static/404_preview-1280x720.jpg";
