/**
 * Auto-sourcing, the Twitch half: the wall goes and finds live Twitch streams.
 *
 * Until this existed, sourcing meant YouTube and only YouTube. A Twitch channel
 * reached the wall exactly two ways — somebody pasted its link, or an admin put
 * it on the watchlist — so the feature whose whole promise is "the wall fills
 * itself" found, on Twitch, nothing at all. This is the missing leg.
 *
 * Everything here is pure, for the same reason `lib/discover.ts` is: the suite
 * runs in vitest's default node environment with no mocks, so a decision only
 * gets pinned if it lives in a function like these. The fetching is
 * `lib/twitch-sourcing.ts`, server-side.
 *
 * ## Categories, not keywords — and that is Twitch's doing, not a shortcut
 *
 * The obvious mirror of YouTube's `search.list` is `/helix/search/channels`, and
 * it is the wrong instrument. What it queries is the broadcaster's login, their
 * display name and the channel's category name — **not** the stream's title. So
 * `query=live coding` on Twitch does not mean "streams about live coding"; it
 * means "channels called something like live coding". A keyword leg built on it
 * would be a slower, vaguer spelling of the category leg below, with a search
 * index's freshness in front of it.
 *
 * `/helix/streams?game_id=…` is the strong one, and it is better than YouTube's
 * equivalent in every way that matters here:
 *
 * - **Everything it returns is live by Helix's own contract.** `/streams` has a
 *   row per channel that is on air and no rows for anything else, so there is no
 *   self-confirming search index to filter — the trap `readConfirmed` exists to
 *   catch on the YouTube side simply is not present. No confirmation leg is
 *   needed because the candidate leg *is* the confirmation.
 * - **It is ordered by concurrent viewers**, descending, by Twitch.
 * - **It carries the real title, the viewer count and the category** in the same
 *   response, so a tile is complete without a second call.
 * - **Up to a hundred categories fit in one request**, which is why asking about
 *   every configured category costs exactly one.
 *
 * ## Category names, resolved rather than hardcoded
 *
 * A category is addressed by a numeric `game_id`, and the id for "Software and
 * Game Development" is a magic number nobody can check by reading it. So the
 * deployment configures *names* and `/helix/games?name=` turns them into ids —
 * one cheap call, cached. A misspelled name then fails as "Twitch does not know
 * that category" — a distinct, fixable reason the run can report — instead of a
 * correct-looking request that returns nothing forever.
 */

import { MAX_SOURCED } from "./discover";
import type { Metadata } from "./stream";
import { twitchKey, twitchPosterUrl, twitchWatchUrl } from "./twitch";

/**
 * What the wall looks for on Twitch when nobody has said otherwise.
 *
 * Twitch's own spelling of each, because `/helix/games?name=` matches the name
 * as Twitch writes it. "Software and Game Development" is where people who are
 * coding on stream actually are; "Science & Technology" is the older, broader
 * one they were in before that category existed and some still use.
 *
 * Seeds rather than a fixed list — `TWITCH_DISCOVER_CATEGORIES` replaces these
 * at deploy time. There is deliberately no path for a category arriving from a
 * browser, the same refusal `resolveKeywords` makes and for a weaker version of
 * the same reason: Helix has no daily cliff, but a visitor-supplied query is
 * still a visitor spending the deployment's rate limit.
 */
export const TWITCH_SEED_CATEGORIES = ["Software and Game Development", "Science & Technology"];

/**
 * How many categories a deployment may ask about.
 *
 * Not a budget — a hundred `game_id`s fit in the one request either way, so this
 * costs nothing extra. It is a bound on how much of the wall the leg can be
 * pointed at: four unrelated categories is already a wall with no subject.
 */
export const MAX_TWITCH_CATEGORIES = 4;

/**
 * How many live streams one Twitch run will put up.
 *
 * The leg is capable of returning a hundred rows in viewer order, and
 * `mergeSourced` caps the sourced run at `MAX_SOURCED` *in total* — so without a
 * cap of its own the Twitch leg would fill every sourced slot on its own and the
 * YouTube leg would never place a tile. Half the wall's sourced capacity each is
 * the split, and it is written as the arithmetic rather than as a number so it
 * follows `MAX_SOURCED` if that ever moves.
 */
export const MAX_TWITCH_FOUND = Math.floor(MAX_SOURCED / 2);

/**
 * How many rows to ask `/streams` for.
 *
 * More than we intend to keep, because `readLiveStreams` filters: a row can be
 * dropped for being mature or for having no title, and the mature ones cluster
 * near the top of a viewer-ordered list rather than distributing evenly. Five
 * times the cap is enough slack to still fill the wall after that, and Twitch's
 * own ceiling for `first` is a hundred.
 */
export const TWITCH_PAGE = Math.min(100, MAX_TWITCH_FOUND * 5);

/**
 * Seconds the Twitch leg is cached for.
 *
 * **Chosen, not derived** — and that inversion is the whole difference from
 * `DISCOVER_TTL`. YouTube's TTL falls out of a hundred-calls-a-day cliff that
 * cannot be bought, so the number is arithmetic. Twitch's limit is a per-minute
 * points bucket that refills continuously and is nowhere near empty at this
 * volume, so there is no cliff to divide by and the TTL is free to be picked for
 * freshness instead. Two minutes is `FEED_TTL`'s number, for the same reason: it
 * is short enough that a stream which just started is up on the next visit, and
 * long enough that a burst of visitors is one request.
 *
 * `twitch-discover.test.ts` pins that the choice stays inside the bucket, so a
 * later decision to shorten it has to face the arithmetic.
 */
export const TWITCH_DISCOVER_TTL = 120;

/**
 * Requests one discovery run costs: the category lookup and the stream fetch.
 *
 * The category lookup is cached for far longer than the run — Twitch's category
 * ids do not change — so this is the cold-start cost, and the steady state is
 * one.
 */
export const TWITCH_REQUESTS_PER_RUN = 2;

/**
 * Requests a minute this leg is allowed of Twitch's bucket.
 *
 * Helix gives an app token 800 points a minute and charges a point per request.
 * This leg claims a small, fixed slice, because it is not the only caller: the
 * watchlist sweep spends one uncached request per page load and every lookup
 * spends two or three. Sourcing is the least urgent of the three, so it takes
 * the smallest share — and the headroom between this and 800 is the point.
 */
export const TWITCH_REQUESTS_PER_MINUTE = 8;

/**
 * Category names Twitch will recognise: its own punctuation, and nothing else.
 *
 * An allowlist rather than an escape, the same discipline `sanitizeKeyword`
 * applies — the name is interpolated into a query we hand to Twitch, so a name
 * outside the charset fails whole instead of being encoded into the URL.
 *
 * Wider than the keyword allowlist because real category names need it:
 * "Science & Technology" has an ampersand, and so do "Makers & Crafting" and
 * "Dungeons & Dragons".
 */
const CATEGORY = /^[A-Za-z0-9 '&:!.,+/-]+$/;

/** Twitch's category ids are decimal. Anything else is not one. */
const GAME_ID = /^\d{1,20}$/;

/**
 * Twitch logins, as `lib/twitch.ts` spells them.
 *
 * A copy of that module's private regex rather than an import, because what it
 * guards there is a *parse* of something a person typed and what it guards here
 * is a *field off a response* — the two are free to diverge if Twitch ever
 * widens one and not the other. The copy is checked against `parseTwitchKey` in
 * the suite, so it cannot drift silently.
 */
const LOGIN = /^[a-z0-9_]{1,25}$/;

/**
 * A category name we are willing to hand to Twitch, or null.
 *
 * **Case is preserved**, which is the one way this differs from
 * `sanitizeKeyword` and the reason it is a separate function rather than a
 * parameter on that one. A keyword is lowercased because YouTube's search is
 * case-insensitive, so folding case loses nothing and makes the dedupe catch
 * duplicates. `/helix/games?name=` is a lookup of a name, not a search, and it
 * wants the name as Twitch spells it — lowercasing "Science & Technology" would
 * turn a category that resolves into one that does not.
 */
export function sanitizeCategory(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 64) return null;
  return CATEGORY.test(name) ? name : null;
}

/**
 * The category list, from the environment or the seeds.
 *
 * Duplicates are collapsed **case-insensitively** even though the names keep
 * their case: `/helix/games` would answer the same row twice for "art" and
 * "Art", and asking twice for one category wastes a slot out of
 * `MAX_TWITCH_CATEGORIES`. The first spelling wins, because it is the one the
 * operator wrote and the one with a chance of matching.
 */
export function resolveCategories(env: string | undefined): string[] {
  const source = env?.trim() ? env.split(",") : TWITCH_SEED_CATEGORIES;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of source) {
    const name = sanitizeCategory(raw);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= MAX_TWITCH_CATEGORIES) break;
  }
  return out;
}

/**
 * Categories out of a `/helix/games` response.
 *
 * Total over junk, because this is upstream-shaped data rather than data we
 * shaped: a response with no `data`, a row with no id, an id that is not a
 * number. Every one of those is a row we skip, not a throw — and the ids go
 * through `GAME_ID` before they are handed back, because the next thing that
 * happens to them is being interpolated into another Twitch URL.
 *
 * The name comes back alongside the id so the caller can tell "Twitch has never
 * heard of this category" from "the category is real and nobody is streaming
 * it". Those look identical from the stream call alone, and only one of them is
 * a typo in the deployment's configuration.
 */
export function readGames(json: unknown): { id: string; name: string }[] {
  const rows = (json as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];

  const out: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = (row as { id?: unknown })?.id;
    const name = (row as { name?: unknown })?.name;
    if (typeof id !== "string" || !GAME_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: typeof name === "string" && name.trim() ? name : id });
  }
  return out;
}

/** A `/helix/streams` row, as much of it as this leg reads. */
interface StreamRow {
  user_login?: unknown;
  user_name?: unknown;
  game_name?: unknown;
  title?: unknown;
  type?: unknown;
  viewer_count?: unknown;
  is_mature?: unknown;
}

/** A trimmed non-empty string, or undefined. Upstream fields arrive as anything. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * The live streams in a `/helix/streams` response, as wall metadata.
 *
 * Three filters, and each one is a promise the wall already makes elsewhere:
 *
 * - **`type === "live"`.** Helix's own field. Every row here should be live by
 *   the endpoint's contract, so this is belt and braces rather than the
 *   load-bearing check `readConfirmed` is — but it costs a comparison, and
 *   asserting `isLive: true` on a row that did not say so is exactly the
 *   invention this codebase refuses to make.
 * - **Not `is_mature`.** The wall opens in monitors mode, so every tile is a
 *   video autoplaying on a page nobody asked to have filled. That is the same
 *   reason the YouTube leg sends `safeSearch: "strict"`, and this is the same
 *   call made with the field Twitch gives us.
 * - **A real title.** A tile that says nothing about what it is playing is
 *   worse than one fewer tile — `readConfirmed`'s rule, unchanged.
 *
 * The login is validated before it is used, because it arrives from a response
 * and the next thing that happens to it is being built into an embed URL and a
 * wall key. `twitchKey` is the only thing that mints those keys, here as
 * everywhere.
 *
 * **The thumbnail is rebuilt from the login, never read from the response.** The
 * response's `thumbnail_url` is a template of the same URL, so trusting it buys
 * nothing and costs the one guarantee `twitchPosterUrl` gives: it is the
 * channel's *current* frame, refreshing itself, which is the closest a wall of
 * monitors gets to a monitor. Same instinct as rebuilding YouTube's `mqdefault`
 * from the video id rather than trusting the URL in the payload.
 *
 * The order Twitch sent is kept, because Twitch sent it in viewer order and the
 * cap is a "top N" only if nothing reshuffles it first.
 */
export function readLiveStreams(json: unknown, cap = MAX_TWITCH_FOUND): Metadata[] {
  const rows = (json as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];

  const out: Metadata[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    if (out.length >= cap) break;
    const row = raw as StreamRow;

    if (row?.type !== "live") continue;
    if (row.is_mature === true) continue;

    const login = typeof row.user_login === "string" ? row.user_login.trim().toLowerCase() : "";
    if (!LOGIN.test(login) || seen.has(login)) continue;

    const title = text(row.title);
    if (!title) continue;

    seen.add(login);
    const source = { kind: "channel", id: login } as const;
    // `typeof`, not `Number()`. Helix sends the count as a JSON number, and
    // coercing instead would turn a `null` — which is Twitch declining to say —
    // into a confident zero, because `Number(null)` is 0. "Nobody is watching"
    // and "we were not told" are different facts and only one of them is ours to
    // draw.
    const viewers = typeof row.viewer_count === "number" ? row.viewer_count : Number.NaN;
    out.push({
      videoId: twitchKey(source),
      title,
      channel: text(row.user_name) ?? login,
      channelUrl: twitchWatchUrl(source),
      thumbnail: twitchPosterUrl(source),
      // The category, which is the nearest Twitch has to a description and the
      // same field the watchlist sweep puts here — so a Twitch tile reads the
      // same whichever leg found it.
      description: text(row.game_name),
      // Confirmed by `/streams`, which has no rows for anything off air.
      isLive: true,
      // Absent is not zero: a row with no count stays undefined rather than
      // being drawn as "0 watching".
      viewers: Number.isFinite(viewers) && viewers >= 0 ? viewers : undefined,
    });
  }
  return out;
}
