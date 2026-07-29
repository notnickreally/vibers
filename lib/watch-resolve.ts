/**
 * Who is this? — a pasted username or link, turned into a real channel.
 *
 * `lib/watch.ts` decides what the text *could* name; this establishes what it
 * actually names, by asking the platform. Nothing here invents a name: if
 * neither the API nor the public page will say what a channel is called, the
 * add fails rather than storing the string somebody typed as though it were the
 * channel's name. Same promise the wall already makes about titles and
 * thumbnails, applied one level up.
 *
 * Both platforms have a keyless path and a credentialed one, and the keyless
 * path is the one that makes the feature work out of the box:
 *
 * - **YouTube.** With `YOUTUBE_API_KEY`, `channels.list` — one unit out of ten
 *   thousand a day, on the cheap bucket that `videos.list` shares, *not* the
 *   hundred-a-day search bucket. Without it, the channel's own page, whose
 *   `<link rel="canonical">` carries the `UC…` id that everything downstream
 *   needs.
 * - **Twitch.** `lookupTwitch` already does exactly this job for a channel link
 *   — OpenGraph tags with no credentials, Helix on top of them when there are
 *   any — so this calls it rather than growing a second answer to the same
 *   question.
 *
 * Resolution happens **once, at add time**. What is stored is a channel id and
 * a name, so the sweep that runs every page load never pays for any of this.
 */

import "server-only";

import { LookupError } from "./lookup";
import { twitchWatchUrl } from "./twitch";
import { lookupTwitch } from "./twitch-lookup";
import { channelUrl, type WatchLookup, type WatchTarget } from "./watch";

/** What the watchlist needs before it will store a channel. */
export interface Resolved {
  target: WatchTarget;
  name: string;
  url: string;
}

/**
 * A browser-ish User-Agent, for the same reason `lib/twitch-lookup.ts` sends
 * one: the markup a crawler gets back is a different, emptier shell.
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/* ---------------------------------------------------------------------------
   YouTube.
--------------------------------------------------------------------------- */

interface ChannelItem {
  id?: string;
  snippet?: { title?: string; customUrl?: string };
}

/**
 * The `channels.list` parameter each kind of lookup needs.
 *
 * Three different parameters rather than one, because YouTube genuinely has
 * three namespaces here and they do not accept each other's values: `id` takes
 * a `UC…`, `forHandle` takes an `@name`, and `forUsername` takes the legacy
 * account name that `/user/<name>` URLs carry. Handing one the other's value is
 * an empty answer, not an error, which is why they are kept apart.
 */
function channelsParam(lookup: Extract<WatchLookup, { provider: "youtube" }>): [string, string] {
  if (lookup.by === "id") return ["id", lookup.value];
  if (lookup.by === "handle") return ["forHandle", `@${lookup.value}`];
  return ["forUsername", lookup.value];
}

async function youtubeFromApi(
  lookup: Extract<WatchLookup, { provider: "youtube" }>,
  key: string,
): Promise<Resolved | null> {
  const [name, value] = channelsParam(lookup);
  const params = new URLSearchParams({ part: "snippet", [name]: value, key });
  let json: { items?: ChannelItem[] };
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    json = (await res.json()) as { items?: ChannelItem[] };
  } catch {
    return null;
  }

  const item = json.items?.[0];
  const id = item?.id;
  // A vanity `/c/<name>` is the one lookup YouTube answers for some channels
  // and nobody answers for others, so an empty answer here is "ask the page",
  // not "no such channel". The page fallback below decides that.
  if (typeof id !== "string" || !CHANNEL_ID.test(id)) return null;

  const title = item?.snippet?.title;
  if (typeof title !== "string" || !title.trim()) return null;

  const target: WatchTarget = { provider: "youtube", id };
  return { target, name: title.trim(), url: channelUrl(target) };
}

/** The URL a lookup names on youtube.com, for the keyless leg to read. */
function youtubePageUrl(lookup: Extract<WatchLookup, { provider: "youtube" }>): string {
  if (lookup.by === "id") return `https://www.youtube.com/channel/${lookup.value}`;
  if (lookup.by === "handle") return `https://www.youtube.com/@${encodeURIComponent(lookup.value)}`;
  return `https://www.youtube.com/user/${encodeURIComponent(lookup.value)}`;
}

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

/**
 * The channel id out of a channel page.
 *
 * `<link rel="canonical">` is the reliable one: YouTube points every spelling
 * of a channel — handle, vanity URL, legacy username — at the same
 * `/channel/UC…` canonical, which is exactly the normalisation we are asking
 * for. The `"channelId"` fallback is the same value out of the page's embedded
 * JSON, for the days the canonical is a relative URL or absent.
 *
 * Whatever is found is checked against the id format before it is used, because
 * it came off someone else's page and the next thing that happens to it is
 * being interpolated into a Google URL.
 */
function readChannelId(html: string): string | null {
  const canonical = html.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*\/channel\/(UC[A-Za-z0-9_-]{22})/i,
  )?.[1];
  if (canonical) return canonical;
  const embedded = html.match(/"(?:channelId|externalId)":"(UC[A-Za-z0-9_-]{22})"/)?.[1];
  return embedded ?? null;
}

/** `Someone - YouTube` → `Someone`. */
function displayName(title: string | undefined): string | null {
  const trimmed = title?.replace(/\s*-\s*YouTube\s*$/i, "").trim();
  return trimmed && trimmed !== "YouTube" ? trimmed : null;
}

async function youtubeFromPage(
  lookup: Extract<WatchLookup, { provider: "youtube" }>,
): Promise<Resolved | null> {
  let html: string;
  try {
    const res = await fetch(youtubePageUrl(lookup), {
      headers: { "user-agent": UA, accept: "text/html" },
      // A channel's id and name do not change minute to minute, and this only
      // ever runs when an admin presses Add.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    // The tags and the canonical live in `<head>`; the rest is the app bundle.
    html = (await res.text()).slice(0, 400_000);
  } catch {
    return null;
  }

  const id = readChannelId(html);
  if (!id) return null;
  const name = displayName(meta(html, "og:title"));
  if (!name) return null;

  const target: WatchTarget = { provider: "youtube", id };
  return { target, name, url: channelUrl(target) };
}

async function resolveYouTube(
  lookup: Extract<WatchLookup, { provider: "youtube" }>,
): Promise<Resolved> {
  const key = process.env.YOUTUBE_API_KEY;
  const found = (key ? await youtubeFromApi(lookup, key) : null) ?? (await youtubeFromPage(lookup));
  if (found) return found;
  throw new LookupError(
    "No such YouTube channel — or YouTube wouldn't say. Check the handle, or paste the channel link.",
    404,
  );
}

/* ---------------------------------------------------------------------------
   Twitch.
--------------------------------------------------------------------------- */

async function resolveTwitch(
  lookup: Extract<WatchLookup, { provider: "twitch" }>,
): Promise<Resolved> {
  const source = { kind: "channel", id: lookup.value } as const;
  // `lookupTwitch` throws a 404 `LookupError` for a channel that isn't there —
  // by the generic-shell check with no credentials, by Helix with them — which
  // is the same refusal this function wants to make.
  const looked = await lookupTwitch(source);
  return {
    target: { provider: "twitch", id: lookup.value },
    name: looked.channel || lookup.value,
    url: twitchWatchUrl(source),
  };
}

/**
 * A parsed lookup, established against its platform. Throws `LookupError`.
 *
 * The throw is the point: an add that cannot name the channel must fail loudly
 * in the panel, because the alternative — storing the raw text as the name — is
 * a watchlist entry that looks fine and watches nobody.
 */
export async function resolveWatch(lookup: WatchLookup): Promise<Resolved> {
  return lookup.provider === "twitch" ? resolveTwitch(lookup) : resolveYouTube(lookup);
}
