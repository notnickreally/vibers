/**
 * One lookup, whichever platform the link came from.
 *
 * `lib/lookup.ts` asks YouTube and `lib/twitch-lookup.ts` asks Twitch; this
 * picks between them and is the only thing the routes import. It is a separate
 * module rather than a branch inside either of those on purpose — each of them
 * would otherwise have to import the other to reach the shared `LookupError`,
 * and a cycle between the two lookups is not worth saving a file.
 *
 * The promise the whole wall rests on is unchanged and now covers both
 * platforms: **nothing on vibers.tv is invented about a stream or its
 * creator.** The routes take a key and nothing else, and the title, channel and
 * thumbnail are asked for here.
 */

import "server-only";

import { type Looked, lookupVideo } from "./lookup";
import type { Source } from "./source";
import { lookupTwitch } from "./twitch-lookup";

/** Everything the source's platform will tell us about it. Throws `LookupError`. */
export async function lookupSource(source: Source): Promise<Looked> {
  return source.provider === "twitch" ? lookupTwitch(source) : lookupVideo(source.id);
}
