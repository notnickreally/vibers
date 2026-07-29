/**
 * Which platform a stream came from — the one place that decides.
 *
 * The wall used to be YouTube and nothing else, so "the video id" and "the
 * thing on the wall" were the same string and every module was free to assume
 * eleven characters of base64url. Twitch broke that assumption, and this module
 * is the seam that stops it breaking anything else: everywhere upstream now
 * asks *here* what a stored key is, and gets an embed, a poster, a link out and
 * a label back without ever naming a platform itself.
 *
 * **The key format is the compatibility promise.** A bare YouTube video id
 * stays exactly what it was — no prefix, no migration, every row already in
 * Neon and every `/watch/<id>` link already shared still resolves. Anything
 * else carries its provider in front of it, which today means `twitch:`. New
 * providers add a prefix and a branch in `parseKey`; they never touch the rows.
 *
 * Pure and client-safe on purpose. The wall's components import it to draw a
 * tile, the routes import it to validate a request, and the suite imports it to
 * pin the parsing — so nothing here may reach for the network or the database.
 * The asking-Twitch-things half lives in `lib/twitch-lookup.ts`, server-side.
 */

import {
  isTwitchKey,
  parseTwitch,
  parseTwitchKey,
  twitchChatPopoutUrl,
  twitchChatUrl,
  twitchEmbedUrl,
  twitchKey,
  twitchPosterUrl,
  type TwitchSource,
  twitchWatchUrl,
} from "./twitch";
import {
  embedUrl,
  isVideoId,
  parseYouTube,
  posterUrl,
  type YouTubeSource,
  watchUrl,
} from "./youtube";

export type Provider = "youtube" | "twitch";

export const PROVIDERS: Provider[] = ["youtube", "twitch"];

/** What each platform is called when the interface has to say it out loud. */
export const PROVIDER_LABEL: Record<Provider, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
};

/**
 * A parsed link, tagged with where it came from.
 *
 * A discriminated union rather than a common shape, because the two platforms
 * genuinely do not address the same kind of thing: YouTube names a video, and
 * Twitch names *either* a video-like thing (a VOD, a clip) *or* a channel whose
 * content changes under it. Flattening that into one `id` field would delete
 * the distinction the embed and the chat both depend on.
 */
export type Source =
  | ({ provider: "youtube" } & YouTubeSource)
  | ({ provider: "twitch" } & TwitchSource);

/** One platform's half of `Source`, for the components that only draw one. */
export type SourceOf<P extends Provider> = Extract<Source, { provider: P }>;

/**
 * A pasted link or id, from either platform — or null.
 *
 * YouTube is tried first because it is the only one of the two that accepts a
 * bare id, and a bare id is the most ambiguous thing anyone can paste. Neither
 * parser can claim the other's hosts, so the order is a tie-break on that one
 * case and nothing more.
 */
export function parseSource(input: string): Source | null {
  const yt = parseYouTube(input);
  if (yt) return { provider: "youtube", ...yt };
  const tw = parseTwitch(input);
  if (tw) return { provider: "twitch", ...tw };
  return null;
}

/** The string the wall stores, and the segment `/watch/<key>` carries. */
export function sourceKey(source: Source): string {
  return source.provider === "twitch" ? twitchKey(source) : source.id;
}

/**
 * A stored key, back into a source — or null for anything that isn't one.
 *
 * Every caller that holds a key from the database or from a URL path goes
 * through here, and the null branch is load-bearing rather than defensive: a
 * key that doesn't parse must become a 404 or a tile that says so, never a
 * request or an `iframe src` built out of an unvalidated string.
 */
export function parseKey(key: string): Source | null {
  if (typeof key !== "string") return null;
  if (isTwitchKey(key)) {
    const tw = parseTwitchKey(key);
    return tw ? { provider: "twitch", ...tw } : null;
  }
  return isVideoId(key) ? { provider: "youtube", id: key } : null;
}

/** Which platform a stored key belongs to, without unpacking it. */
export function providerOf(key: string): Provider | null {
  return parseKey(key)?.provider ?? null;
}

export function isSourceKey(key: string): boolean {
  return parseKey(key) !== null;
}

/**
 * The site's own watch link for a key.
 *
 * Encoded, because a Twitch key carries colons and a path segment is not the
 * place to find out whether every router in the stack agrees about those.
 * Next decodes the segment before it reaches the page, so `parseKey` on the
 * other side sees the key exactly as it was stored.
 */
export function watchHref(key: string): string {
  return `/watch/${encodeURIComponent(key)}`;
}

/**
 * The other half of `watchHref`: a `/watch/<segment>` back into a key.
 *
 * Next hands a dynamic segment over **exactly as it appears in the URL**, still
 * percent-encoded — verified against `/watch/[id]` on 16.2, where the param
 * arrives as `twitch%3Achannel%3Asomeone`. A bare YouTube id has nothing to
 * encode, which is why this never had to exist before Twitch's colons.
 *
 * A malformed escape throws rather than returning anything, so it is caught and
 * turned into the same null the parsers use: a segment nobody can decode is a
 * 404, not a crash.
 */
export function decodeKeySegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

interface EmbedOptions {
  /** The parent hostname. Twitch refuses to frame without it; YouTube ignores it. */
  parent?: string;
  autoplay?: boolean;
  muted?: boolean;
  /** The platform's own control bar. Off for wall tiles. */
  controls?: boolean;
}

/**
 * The embed URL for a source, or null when it cannot be framed here.
 *
 * Null is Twitch's case, and it is a real one rather than a formality: without
 * a `parent` that matches the page's hostname exactly, Twitch answers with
 * `X-Frame-Options: SAMEORIGIN` and the frame stays blank with no error to
 * catch. The hostname only exists in a browser, so a Twitch embed cannot be
 * built during a server render at all — which is why every caller either passes
 * one or handles the null.
 */
export function embedFor(source: Source, options: EmbedOptions = {}): string | null {
  if (source.provider === "twitch") {
    return options.parent ? twitchEmbedUrl(source, options.parent, options) : null;
  }
  return embedUrl(source, {
    autoplay: options.autoplay ?? true,
    muted: options.muted ?? options.autoplay ?? true,
    controls: options.controls ?? true,
  });
}

/** Where this lives on its own platform. */
export function watchLinkUrl(source: Source): string {
  return source.provider === "twitch" ? twitchWatchUrl(source) : watchUrl(source);
}

/** The poster that stands in for the picture until there is one. */
export function posterFor(source: Source): string {
  return source.provider === "twitch" ? twitchPosterUrl(source) : posterUrl(source.id);
}

/**
 * The stream's own chat, framable — or null where there is none to carry.
 *
 * Both platforms gate framing on the parent hostname, under different names
 * (`embed_domain`, `parent`), and both refuse without it. The YouTube branch
 * stays in `components/chat/live-chat.tsx` because posting there needs a whole
 * sign-in dance that has no Twitch equivalent; what this covers is the read-along
 * frame, which is the part the two platforms actually share.
 */
export function chatFrameUrl(source: Source, parent: string): string | null {
  return source.provider === "twitch" ? twitchChatUrl(source, parent) : null;
}

/** The chat as a page of its own, for the escape hatch under the frame. */
export function chatPopoutUrl(source: Source): string | null {
  return source.provider === "twitch" ? twitchChatPopoutUrl(source) : null;
}

/**
 * What to call the thing behind a key, when a sentence needs a noun.
 *
 * "Video" is wrong for a Twitch channel — what is on air is a broadcast, and
 * tomorrow it is a different one — and "stream" is wrong for a clip.
 */
export function sourceNoun(source: Source): string {
  if (source.provider === "youtube") return "video";
  if (source.kind === "channel") return "channel";
  if (source.kind === "clip") return "clip";
  return "VOD";
}
