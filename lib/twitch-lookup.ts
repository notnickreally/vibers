/**
 * Look up a Twitch source's real metadata.
 *
 * Two sources, in the same order and for the same reason `lib/lookup.ts` uses
 * two for YouTube:
 *
 * - **The public page's OpenGraph tags** — no key, no quota, always on. Gives a
 *   channel's real display name, its bio and its profile image. This is what
 *   makes Twitch work out of the box, the way oEmbed does for YouTube.
 * - **Helix** — only if `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` are set.
 *   Adds the current stream title, whether the channel is actually on air, and
 *   the concurrent viewer count, plus real titles for VODs and clips.
 *
 * Anything we can't establish stays undefined rather than being guessed. A
 * channel is only labelled live when Helix said so — the public page cannot
 * honestly tell us, and a wall that inferred it from a preview image would be
 * inventing a fact about someone else's broadcast.
 *
 * Where the platforms genuinely differ, this file differs with them rather than
 * pretending: a Twitch **channel** has no per-broadcast title without Helix, so
 * with no credentials the card carries the channel's own name and says nothing
 * about what is on. That is less than YouTube gives for free, and it is the
 * truth rather than a placeholder.
 */

import "server-only";

import type { Looked } from "./lookup";
import { LookupError } from "./lookup";
import {
  type HelixClip,
  type HelixStream,
  type HelixUser,
  type HelixVideo,
  credentials,
  helix,
  sizeThumbnail,
} from "./twitch-api";
import {
  TWITCH_NO_PREVIEW,
  type TwitchSource,
  twitchKey,
  twitchPosterUrl,
  twitchWatchUrl,
} from "./twitch";

/**
 * A browser-ish User-Agent, because the tags only exist for one.
 *
 * Twitch is a single-page app; the markup it serves to a crawler is a shell
 * whose entire useful content is its `<meta property="og:…">` block. Asking
 * without a UA gets a different, emptier shell.
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * What Twitch serves when the thing you asked for does not exist.
 *
 * A missing channel is **not** a 404 — the SPA answers 200 with its generic
 * shell, and the only difference from a real channel's page is right here:
 * `og:title` is the bare site name instead of `<Display name> - Twitch`.
 * Checked against www.twitch.tv, 2026-07-28: `/theprimeagen` →
 * `ThePrimeagen - Twitch`, `/zzznotarealchannelzzz` → `Twitch`.
 */
const GENERIC_TITLE = "Twitch";

/** `<meta property="og:title" content="…">`, either attribute order. */
function meta(html: string, property: string): string | undefined {
  const name = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*property=["']${name}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const found = html.match(pattern)?.[1];
    if (found) return decodeEntities(found);
  }
  return undefined;
}

/** The five entities an HTML attribute can carry. Nothing else needs decoding. */
function decodeEntities(value: string): string {
  return value
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

interface Tags {
  title?: string;
  description?: string;
  image?: string;
  /** True when the page is Twitch's generic shell — i.e. there is nothing there. */
  generic: boolean;
}

async function fromPage(url: string): Promise<Tags | null> {
  // The name, bio and avatar behind a Twitch link do not change minute to
  // minute, so this leg is cached — it is pure latency on the way to painting
  // the page. Liveness is Helix's job below and is deliberately left uncached.
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;

  // The tags live in `<head>`; the rest is the app bundle's script tags, and
  // reading all of it into memory per lookup buys nothing.
  const html = (await res.text()).slice(0, 200_000);
  const title = meta(html, "og:title");
  return {
    title,
    description: meta(html, "og:description"),
    image: meta(html, "og:image"),
    generic: !title || title === GENERIC_TITLE,
  };
}

/** `ThePrimeagen - Twitch` → `ThePrimeagen`. */
function displayName(title: string | undefined, login: string): string {
  const trimmed = title?.replace(/\s*-\s*Twitch\s*$/i, "").trim();
  return trimmed && trimmed !== GENERIC_TITLE ? trimmed : login;
}

/**
 * A live channel, or an offline one, from Helix.
 *
 * The absence of a row **is** the answer here, unlike YouTube's `videos.list`
 * where a missing id means "we were told nothing". `/helix/streams` returns one
 * row per channel that is on air, so an empty answer for a channel we know
 * exists is a confirmed `isLive: false`.
 *
 * Both calls go out **at once**. They ask independent questions — who is this,
 * and are they on right now — and neither answer feeds the other's request, so
 * asking in series only added the slower one's latency to the faster one's. The
 * one thing that has to be true is that a failed `/users` still refuses the
 * channel, and it does: `users` is resolved and checked before anything is built
 * out of `streams`.
 */
async function channelFromHelix(login: string): Promise<Partial<Looked> | null> {
  if (!credentials()) return null;

  const [users, streams] = await Promise.all([
    helix<{ data?: HelixUser[] }>("users", new URLSearchParams({ login })),
    helix<{ data?: HelixStream[] }>("streams", new URLSearchParams({ user_login: login })),
  ]);

  // A null here is a failed request, not an empty one — Helix being unreachable
  // must leave the page lookup's answer standing rather than 404 a real channel.
  if (!users) return null;
  const user = users.data?.[0];
  if (!user) throw new LookupError("No such Twitch channel.", 404);

  const name = user.display_name || login;
  if (!streams) {
    return { title: name, channel: name, description: user.description || undefined };
  }

  const live = streams.data?.[0];
  return {
    title: live?.title || name,
    channel: name,
    description: user.description || undefined,
    isLive: Boolean(live),
    viewers: live?.viewer_count,
  };
}

/**
 * What a channel looks like before either source has been asked.
 *
 * The name defaults to the login, which is the one thing we already know for
 * certain and is never a guess: `twitch.tv/theprimeagen` really is addressed by
 * `theprimeagen`. Everything above this replaces it with what the channel calls
 * itself.
 */
function channelBase(source: TwitchSource, name: string, description?: string): Looked {
  return {
    videoId: twitchKey(source),
    // With no Helix there is no broadcast title to show, so the card carries
    // the channel's own name rather than a made-up one.
    title: name,
    channel: name,
    channelUrl: twitchWatchUrl(source),
    // Always the live-preview URL rather than a stored snapshot: it is the
    // channel's current frame and it refreshes itself, which is the closest a
    // wall of monitors gets to a monitor.
    thumbnail: twitchPosterUrl(source),
    description: description || undefined,
  };
}

/**
 * Everything about one channel — Helix first, the public page as the fallback.
 *
 * **The order is the point, and it used to be the other way round.** This used to
 * fetch and scrape the channel's page unconditionally and then let Helix
 * overwrite nearly all of it, which meant a deployment with credentials paid for
 * up to 200 KB of single-page-app markup on every lookup to extract two fields
 * Helix was about to answer better. `/helix/users` carries the display name and
 * the bio directly, and it is authoritative where `og:title` is a string we
 * pattern-match a suffix off. So with credentials the page is not fetched at
 * all.
 *
 * Without credentials nothing changes: the page is the only source there is, and
 * its generic shell is still the only way to tell a real channel from a
 * nonexistent one. It also remains the fallback when Helix is configured but
 * unreachable — a `null` from `channelFromHelix` is a failed request, and
 * falling back to the page is strictly better than 404ing a channel that exists.
 */
async function lookupChannel(source: TwitchSource): Promise<Looked> {
  const login = source.id;

  if (credentials()) {
    const helixed = await channelFromHelix(login);
    // A throw has already happened above for a channel Helix says isn't there,
    // so a null is Helix being unreachable — fall through to the page.
    if (helixed) return { ...channelBase(source, login), ...helixed };
  }

  const tags = await fromPage(twitchWatchUrl(source));

  // The page is the only check available with no credentials, and it is a good
  // one: Twitch's generic shell is exactly what a nonexistent channel serves.
  // With credentials configured but unreachable it is not a safe refusal — we
  // may simply be looking at a shell we were served for another reason — so the
  // 404 stays gated on there being no other source of truth.
  if (tags?.generic && !credentials()) {
    throw new LookupError("No such Twitch channel.", 404);
  }

  return channelBase(source, displayName(tags?.title, login), tags?.description);
}

async function lookupVideo(source: TwitchSource): Promise<Looked> {
  const tags = await fromPage(twitchWatchUrl(source));
  const base: Looked = {
    videoId: twitchKey(source),
    // Deliberately not the generic page title: a VOD's real title only arrives
    // with Helix, so without it the card names what it is and nothing more.
    title: tags?.generic ? `Twitch VOD ${source.id}` : (tags?.title ?? `Twitch VOD ${source.id}`),
    channel: "Unknown channel",
    thumbnail: (!tags?.generic && tags?.image) || TWITCH_NO_PREVIEW,
    description: tags?.generic ? undefined : tags?.description || undefined,
  };
  if (!credentials()) return base;

  const data = await helix<{ data?: HelixVideo[] }>(
    "videos",
    new URLSearchParams({ id: source.id }),
  );
  if (!data) return base;
  const video = data.data?.[0];
  if (!video) throw new LookupError("No such Twitch VOD.", 404);

  return {
    ...base,
    title: video.title || base.title,
    channel: video.user_name || base.channel,
    channelUrl: video.user_login ? `https://www.twitch.tv/${video.user_login}` : undefined,
    thumbnail: sizeThumbnail(video.thumbnail_url) ?? base.thumbnail,
    description: video.description || base.description,
    // A VOD is a recording, so it is never on air — which is what puts it on the
    // Ended shelf instead of taking a monitor.
    isLive: false,
    publishedAt: video.created_at,
  };
}

async function lookupClip(source: TwitchSource): Promise<Looked> {
  const tags = await fromPage(twitchWatchUrl(source));
  const base: Looked = {
    videoId: twitchKey(source),
    title: tags?.generic ? `Twitch clip ${source.id}` : (tags?.title ?? `Twitch clip ${source.id}`),
    channel: "Unknown channel",
    thumbnail: (!tags?.generic && tags?.image) || TWITCH_NO_PREVIEW,
    isLive: false,
  };
  if (!credentials()) return base;

  const data = await helix<{ data?: HelixClip[] }>("clips", new URLSearchParams({ id: source.id }));
  if (!data) return base;
  const clip = data.data?.[0];
  if (!clip) throw new LookupError("No such Twitch clip.", 404);

  return {
    ...base,
    title: clip.title || base.title,
    channel: clip.broadcaster_name || base.channel,
    thumbnail: sizeThumbnail(clip.thumbnail_url) ?? base.thumbnail,
    publishedAt: clip.created_at,
  };
}

/** Everything Twitch will tell us about one source. Throws `LookupError`. */
export async function lookupTwitch(source: TwitchSource): Promise<Looked> {
  try {
    if (source.kind === "channel") return await lookupChannel(source);
    if (source.kind === "video") return await lookupVideo(source);
    return await lookupClip(source);
  } catch (err) {
    if (err instanceof LookupError) throw err;
    throw new LookupError("Couldn't reach Twitch. Check the connection and try again.", 502);
  }
}
