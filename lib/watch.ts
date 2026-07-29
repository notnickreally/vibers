/**
 * The watchlist: channels the wall keeps an eye on.
 *
 * Auto-sourcing already fills the wall by *keyword* — it goes looking for
 * whatever is live and matches "live coding". This is the other half of the
 * same idea and the one an operator actually asks for: name the people you
 * care about, and the wall puts them up the moment they go on air.
 *
 * Everything here is pure and client-safe, for the same reason `lib/source.ts`
 * and `lib/discover.ts` are: the suite runs in vitest's node environment with
 * no mocks, so a decision only gets pinned if it lives in a function like
 * these. The asking-the-platform halves are `lib/watch-resolve.ts` (who is
 * this?) and `lib/watch-live.ts` (are they on right now?), both server-only.
 *
 * ## Two identifiers, and the difference matters
 *
 * A **watch target** names a channel: a YouTube channel id (`UC…`) or a Twitch
 * login. A **source key** — `lib/source.ts`' — names something that plays. They
 * are different namespaces and this module never blurs them, because they do
 * not line up one-to-one:
 *
 * - Twitch does line up. What is on air on a channel *is* addressed by the
 *   channel, so a watched Twitch login maps straight onto the stream key
 *   `twitch:channel:<login>` and back. `streamKeyFor` is that map.
 * - YouTube does not. A channel is not a video; a channel that goes live mints
 *   a fresh eleven-character video id every broadcast, and that id is what the
 *   wall stores. So a watched YouTube channel has no stream key of its own —
 *   `lib/watch-live.ts` has to go and find the id each time.
 *
 * ## What is accepted, and why a bare word needs a platform
 *
 * `twitch.tv/someone` and `youtube.com/@someone` say which platform they are.
 * A bare `someone` does not — it is a plausible Twitch login *and* a plausible
 * YouTube handle, and guessing would put the wrong person's stream on a wall
 * everybody can see. So the panel sends the platform alongside the text, and a
 * bare word with no platform is refused rather than assumed. A link overrides
 * the platform, because a link is the stronger statement.
 */

import { parseTwitch, twitchKey } from "./twitch";

export type WatchProvider = "youtube" | "twitch";

/** YouTube's channel ids. The only spelling `channels.list?id=` accepts. */
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * YouTube handles, without the `@`.
 *
 * Three to thirty characters of letters, digits, dots, dashes and underscores —
 * YouTube's own published rule. This is a gate on something that gets
 * interpolated into a Google URL, so it is an allowlist rather than an escape.
 */
const HANDLE = /^[A-Za-z0-9._-]{3,30}$/;

/** Legacy `/user/<name>` and vanity `/c/<name>` paths. Looser, and older. */
const LEGACY = /^[A-Za-z0-9._-]{1,80}$/;

/** Twitch logins, as `lib/twitch.ts` spells them. Case is not significant. */
const LOGIN = /^[a-z0-9_]{1,25}$/;

/**
 * A channel we know how to ask about, before anyone has asked.
 *
 * `by` is not decoration: YouTube offers three different lookups and they are
 * not interchangeable. `id` needs no lookup at all, `handle` goes to
 * `forHandle`, and `user` is the legacy path that `forUsername` answers for
 * some channels and nothing answers for others — which is why the resolver has
 * a keyless page fallback behind it.
 */
export type WatchLookup =
  | { provider: "youtube"; by: "id"; value: string }
  | { provider: "youtube"; by: "handle"; value: string }
  | { provider: "youtube"; by: "user"; value: string }
  | { provider: "twitch"; by: "login"; value: string };

/** A channel that has been resolved — this is what the watchlist stores. */
export interface WatchTarget {
  provider: WatchProvider;
  /** A `UC…` channel id for YouTube, a login for Twitch. */
  id: string;
}

/** A row of the watchlist, as every surface above the database sees it. */
export interface Watched extends WatchTarget {
  /** `provider:id`. The primary key, and what `DELETE ?key=` carries. */
  key: string;
  /** What the channel calls itself. Never invented — see `lib/watch-resolve.ts`. */
  name: string;
  /** What the operator typed, kept so the list reads back the way it was entered. */
  input: string;
  /** The channel's page on its own platform. */
  url: string;
  addedAt: number;
  /** Which admin added it. The wall is shared; the watchlist is attributed. */
  addedBy?: string;
  /** When the sweep last saw this channel on air. Absent means never, here. */
  lastLiveAt?: number;
}

/* ---------------------------------------------------------------------------
   Limits and reasons.
--------------------------------------------------------------------------- */

/**
 * How many channels a deployment may watch.
 *
 * Bounded because the sweep's cost is linear in it: one feed fetch per YouTube
 * channel per run. Twitch is one Helix call for up to a hundred logins either
 * way. Fifty is more channels than anyone curates by hand and still one page of
 * feeds.
 */
export const MAX_WATCHED = 50;

/**
 * How far back down a channel's feed to look.
 *
 * A live broadcast is the newest thing on the feed the moment it starts, so one
 * entry would nearly always do. Three is the slack for a channel that uploaded
 * something while the stream was already running — and every one of them is
 * confirmed against `videos.list` anyway, so a wider look costs recall, never
 * correctness.
 */
export const MAX_PER_CHANNEL = 3;

/** Seconds the feed leg is cached for. The confirm leg has its own, shorter. */
export const FEED_TTL = 120;

/** Why the sweep found nothing, when it found nothing. */
export type WatchReason = "empty" | "no-key" | "no-twitch-credentials" | "upstream";

export interface WatchlistResult {
  /** How many channels were checked on each side. */
  watched: number;
  /** The ones confirmed on air, as wall metadata. */
  found: number;
  reasons: WatchReason[];
}

/* ---------------------------------------------------------------------------
   Parsing.
--------------------------------------------------------------------------- */

/** Hosts that are YouTube. `youtu.be` is excluded — it only ever names a video. */
const YOUTUBE_HOSTS = new Set(["youtube.com", "music.youtube.com", "gaming.youtube.com"]);

/** First segments that are YouTube's own pages rather than somebody's channel. */
const YOUTUBE_RESERVED = new Set([
  "about",
  "account",
  "feed",
  "playlist",
  "premium",
  "results",
  "shorts",
  "t",
  "watch",
]);

function youtubeFrom(segments: string[]): WatchLookup | null {
  const [first, second] = segments;
  if (!first) return null;

  if (first === "channel") {
    return second && CHANNEL_ID.test(second) ? { provider: "youtube", by: "id", value: second } : null;
  }
  if (first === "user" || first === "c") {
    return second && LEGACY.test(second) ? { provider: "youtube", by: "user", value: second } : null;
  }
  if (first.startsWith("@")) {
    const handle = first.slice(1);
    return HANDLE.test(handle) ? { provider: "youtube", by: "handle", value: handle } : null;
  }
  // A bare first segment on youtube.com is a legacy vanity URL — unless it is
  // one of YouTube's own routes, in which case it names no channel at all.
  if (YOUTUBE_RESERVED.has(first.toLowerCase())) return null;
  return LEGACY.test(first) ? { provider: "youtube", by: "user", value: first } : null;
}

/**
 * The Twitch branch, delegated rather than rewritten.
 *
 * `parseTwitch` already knows the hosts, the login charset and the list of
 * Twitch's own routes that are not channels. Only its `channel` answer is a
 * watchable thing here: a VOD or a clip is a recording, and a recording never
 * goes live.
 */
function twitchFrom(input: string): WatchLookup | null {
  const parsed = parseTwitch(input);
  if (parsed?.kind !== "channel") return null;
  return { provider: "twitch", by: "login", value: parsed.id };
}

/**
 * A pasted username or profile link, as something we can go and ask about.
 *
 * `hint` is the platform the panel's selector was on. It decides a bare word
 * and nothing else — a recognisable link names its own platform, and that wins,
 * so pasting a Twitch URL with the selector on YouTube adds the Twitch channel
 * rather than failing on a mismatch nobody meant.
 *
 * Returns null for a video link on either platform. A video is a thing to add
 * to the wall directly; the watchlist is for channels, whose content changes
 * under them.
 */
export function parseWatchInput(input: string, hint?: WatchProvider): WatchLookup | null {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw || raw.length > 300) return null;

  // A link, or something host-shaped. Anything with a slash or a dot is worth
  // trying as a URL first; a bare handle has neither.
  if (/[/.]/.test(raw) || raw.startsWith("http")) {
    let url: URL;
    try {
      url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    if (YOUTUBE_HOSTS.has(host)) {
      return youtubeFrom(url.pathname.split("/").filter(Boolean).map(decodeSegment));
    }
    // `twitch.tv`, `player.twitch.tv`, `clips.twitch.tv` — all `parseTwitch`'.
    if (host === "twitch.tv" || host.endsWith(".twitch.tv")) return twitchFrom(raw);
    return null;
  }

  // A bare word. `@name` is YouTube's own spelling of a handle, and a `UC…` is
  // unmistakably a channel id, so those two carry their own platform.
  if (raw.startsWith("@") && hint !== "twitch") {
    const handle = raw.slice(1);
    return HANDLE.test(handle) ? { provider: "youtube", by: "handle", value: handle } : null;
  }
  if (CHANNEL_ID.test(raw)) return { provider: "youtube", by: "id", value: raw };

  const bare = raw.replace(/^@/, "");
  if (hint === "twitch") {
    const login = bare.toLowerCase();
    // Through `parseTwitch` rather than the regex alone, so a bare `directory`
    // is refused by the same list a pasted `twitch.tv/directory` is.
    return LOGIN.test(login) ? twitchFrom(`https://www.twitch.tv/${login}`) : null;
  }
  if (hint === "youtube") {
    return HANDLE.test(bare) ? { provider: "youtube", by: "handle", value: bare } : null;
  }
  // No platform, and nothing in the text says which. Guessing would put the
  // wrong person on a wall everybody can see.
  return null;
}

/** A path segment, undecoded if it is not decodable. Never throws. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/* ---------------------------------------------------------------------------
   Keys.
--------------------------------------------------------------------------- */

/** The watchlist's primary key. Its own namespace — see the note at the top. */
export function watchKey(target: WatchTarget): string {
  return `${target.provider}:${target.id}`;
}

/**
 * A stored key, back into a target — or null.
 *
 * Validated rather than trusted, the same way `parseTwitchKey` is: the id
 * inside is interpolated into a platform URL, and this key arrives from a
 * shared database and from a query string on the way here.
 */
export function parseWatchKey(key: string): WatchTarget | null {
  if (typeof key !== "string") return null;
  const cut = key.indexOf(":");
  if (cut < 1) return null;
  const provider = key.slice(0, cut);
  const id = key.slice(cut + 1);
  if (provider === "youtube") return CHANNEL_ID.test(id) ? { provider, id } : null;
  if (provider === "twitch") return LOGIN.test(id) ? { provider, id } : null;
  return null;
}

/**
 * The `lib/source.ts` key this channel's broadcast lands under — Twitch only.
 *
 * Null for YouTube, and that null is the whole asymmetry: a Twitch channel *is*
 * the address of whatever it is playing, while a YouTube channel mints a new
 * video id every broadcast and only `videos.list` knows which one.
 */
export function streamKeyFor(target: WatchTarget): string | null {
  return target.provider === "twitch" ? twitchKey({ kind: "channel", id: target.id }) : null;
}

/** Where this channel lives on its own platform. */
export function channelUrl(target: WatchTarget): string {
  return target.provider === "twitch"
    ? `https://www.twitch.tv/${target.id}`
    : `https://www.youtube.com/channel/${target.id}`;
}

/**
 * The channel's RSS feed — the keyless half of YouTube live detection.
 *
 * This is what keeps the watchlist off the `search.list` budget entirely. That
 * bucket is a hundred calls a day for every environment at once and cannot be
 * bought (see `lib/discover.ts`), so a per-channel search would spend the whole
 * day on four channels and one page load. The feed costs nothing, needs no key,
 * and carries the channel's fifteen most recent video ids — including a
 * broadcast that has just started. It says *nothing* about liveness, which is
 * why `videos.list` still has to confirm every id it hands over.
 */
export function feedUrl(channelId: string): string | null {
  return CHANNEL_ID.test(channelId)
    ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
    : null;
}

/**
 * Video ids out of a channel feed.
 *
 * A regex rather than an XML parser, and deliberately: the one element we want
 * is `<yt:videoId>`, the ids are eleven characters of a known alphabet, and
 * every one of them is checked against that alphabet before it is handed back —
 * because the next thing that happens to them is being interpolated into
 * another Google URL. Total over junk: a truncated feed, an empty one, or a
 * page that was never a feed all yield an empty list rather than throwing.
 */
export function readFeedIds(xml: unknown, cap = MAX_PER_CHANNEL): string[] {
  if (typeof xml !== "string") return [];
  const out: string[] = [];
  for (const match of xml.matchAll(/<yt:videoId>([^<]{1,64})<\/yt:videoId>/g)) {
    const id = match[1].trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}
