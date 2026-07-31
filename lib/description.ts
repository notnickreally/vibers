/**
 * A stream's description, read into the pieces worth drawing differently.
 *
 * The description is the one long piece of prose on this site that we did not
 * write: it is the channel's own, and it arrives as plain text — YouTube's
 * `snippet.description` and Twitch's bio are UTF-8 strings with real newlines
 * in them, not markup and not markdown. So there is nothing to *parse* here in
 * the document sense. What there is is the handful of runs inside that text
 * which mean something — a URL, a `12:34` chapter mark, a `#tag` — and which,
 * rendered as flat text, are the reader's problem to copy out by hand.
 *
 * Two halves, both pure:
 *
 * - **`tidy`** — what the text should have arrived as. HTML entities that
 *   survived the scrape are decoded, line endings are normalised, trailing
 *   spaces go, and a channel's six blank lines between paragraphs become one.
 * - **`readDescription`** — the tidied text as a list of segments, each
 *   carrying the offset it starts at so the renderer has a stable key that is
 *   not an array index.
 *
 * The renderer builds React elements from these, never HTML: nothing in this
 * file emits markup, and nothing downstream is allowed to, because the input is
 * a third party's text on everyone's screen. The same reasoning is why every
 * `href` here goes out through `safeHttpUrl` and a `null` from it means the run
 * stays plain text — a description is exactly the place a `javascript:` would
 * be posted.
 *
 * What is *not* here is any rewriting of the channel's words. Runs get marked
 * up, whitespace gets tidied, and that is the whole of it — the line under the
 * description promising it is shown as published has to stay true.
 */

import type { Provider } from "./source";
import { safeHttpUrl } from "./youtube";

/** One run of the description, and what it turned out to be. */
export type Segment =
  | { kind: "text"; at: number; text: string }
  | { kind: "link"; at: number; text: string; href: string }
  | { kind: "tag"; at: number; text: string; href: string }
  /** A chapter mark. `seconds` is where it points, already validated. */
  | { kind: "time"; at: number; text: string; seconds: number };

/**
 * The entities worth knowing by name.
 *
 * `lib/twitch-lookup.ts` decodes five of these at scrape time, which is the
 * right place for the ones an HTML *attribute* must carry. This is the other
 * end: whatever else was in the page — a curly apostrophe written `&#8217;`, an
 * ellipsis, a non-breaking space — is already in Postgres on rows added before
 * anyone noticed, and re-scraping every stream to fix them is not a thing this
 * site does. So they are decoded on the way to the screen, where the cost is
 * one pass over a string nobody is going to notice.
 */
const NAMED: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "•",
  deg: "°",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  ndash: "–",
  // Decoded to an ordinary space rather than U+00A0 on purpose: the collapsing
  // below counts whitespace, and a run of hard spaces it can't see is a run
  // that survives to the screen.
  nbsp: " ",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
};

const ENTITY = /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/**
 * One pass, deliberately. A second would turn a channel's literal `&amp;#39;`
 * into an apostrophe it never typed — the text says `&#39;` and that is what
 * the reader should see.
 */
function decodeEntities(value: string): string {
  return value.replace(ENTITY, (whole, body: string) => {
    if (!body.startsWith("#")) return NAMED[body.toLowerCase()] ?? whole;
    const hex = body[1] === "x" || body[1] === "X";
    const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
    return codePoint(code) ?? whole;
  });
}

/** Null for anything `String.fromCodePoint` would throw on, or shouldn't be asked. */
function codePoint(code: number): string | null {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return null;
  // A lone surrogate is not a character, and pasting one into the DOM is how
  // you get a replacement glyph in the middle of someone's sentence.
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}

/**
 * The text as it should have arrived.
 *
 * The blank-line collapse is the one judgement call: three or more newlines
 * become exactly one blank line. Channels pad descriptions with whole screens
 * of nothing to push the "…more" fold down, and `whitespace-pre-wrap` renders
 * every one of them. Two newlines — a real paragraph break — are left alone,
 * because that is the author writing, not the author padding.
 */
export function tidy(raw: string | undefined): string {
  if (!raw) return "";
  return decodeEntities(raw)
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The runs worth marking up, in one alternation so precedence is positional:
 * a URL wins over everything inside it, which is what stops the `12:34` in
 * `example.com/12:34` becoming a seek and the `#anchor` on the end of a link
 * becoming a hashtag.
 *
 * The handle branch refuses a preceding word character so that the `@` in an
 * email address stays an email address.
 */
const TOKEN_SOURCE = [
  "(?<url>(?:https?:\\/\\/|www\\.)[^\\s<>]+)",
  "(?<time>(?<![\\d:])\\d{1,2}:\\d{2}(?::\\d{2})?(?![\\d:]))",
  "(?<tag>#[\\p{L}\\p{N}_]+|(?<![\\p{L}\\p{N}_.@-])@[A-Za-z0-9._-]{3,30})",
].join("|");

/** Trailing punctuation a writer meant as punctuation, not as part of the run. */
const TAIL = ".,;:!?'\"”’";

/**
 * Split a matched run into the part that is the run and the part that is the
 * sentence it sits in. `(see https://example.com/a)` is a link and a bracket,
 * and `https://en.wikipedia.org/wiki/Rust_(programming_language)` is a link —
 * so a closing bracket is only trimmed when nothing inside opened it.
 */
function trimTail(value: string): string {
  let end = value.length;
  while (end > 0) {
    const char = value[end - 1];
    if (char === ")" || char === "]") {
      const open = char === ")" ? "(" : "[";
      // Everything *before* this bracket: the question is whether the run
      // opened one it still owes, and counting the closer against itself
      // makes every balanced pair look unbalanced.
      const inner = value.slice(0, end - 1);
      if (occurrences(inner, open) > occurrences(inner, char)) break;
      end -= 1;
      continue;
    }
    if (!TAIL.includes(char)) break;
    end -= 1;
  }
  return value.slice(0, end);
}

function occurrences(value: string, char: string): number {
  let count = 0;
  for (const c of value) if (c === char) count += 1;
  return count;
}

/**
 * `M:SS`, `MM:SS`, `H:MM:SS` — the spellings a description actually uses — into
 * seconds, or null.
 *
 * Null is doing real work: `1:75` and `2:99` are match-shaped and mean nothing,
 * and a score line like `Set 3: 6:4` should not become a seek to six minutes.
 * A run that comes back null stays text.
 *
 * `lib/youtube.ts` already has `parseStart` for the *other* spelling — the
 * `1h2m30s` a YouTube URL carries. Neither can read the other's, which is why
 * this is its own function rather than a branch added over there.
 */
export function parseTimecode(value: string): number | null {
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isInteger(n) || n < 0)) return null;
  if (parts.length === 2) {
    const [minutes, seconds] = numbers;
    return seconds < 60 ? minutes * 60 + seconds : null;
  }
  const [hours, minutes, seconds] = numbers;
  return minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : null;
}

/**
 * The description, in segments.
 *
 * `provider` is what decides how much of it is live, and the honest default is
 * "none of it": a run only becomes clickable where there is somewhere for the
 * click to go. A chapter mark needs a player with a JS API to seek, which is
 * YouTube's embed and not Twitch's, and a `#tag` needs a platform with hashtag
 * pages, which is the same list. Everything that doesn't qualify comes back as
 * text, spelled exactly as the channel wrote it — the reader loses a link, not
 * a word.
 */
export function readDescription(raw: string | undefined, provider?: Provider): Segment[] {
  const text = tidy(raw);
  if (!text) return [];

  const segments: Segment[] = [];
  let cursor = 0;

  // Built per call rather than shared: a `g` regex carries `lastIndex`, and a
  // module-level one is state two callers can trip over.
  for (const match of text.matchAll(new RegExp(TOKEN_SOURCE, "gu"))) {
    const at = match.index;
    const body = trimTail(match[0]);
    if (!body) continue;
    const segment = mark(body, at, match.groups ?? {}, provider);
    // Nothing to mark up: leave the run where it is and let it fall into the
    // surrounding text, which is why the cursor doesn't move.
    if (!segment) continue;
    if (at > cursor) segments.push({ kind: "text", at: cursor, text: text.slice(cursor, at) });
    segments.push(segment);
    cursor = at + body.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", at: cursor, text: text.slice(cursor) });
  }
  return segments;
}

function mark(
  body: string,
  at: number,
  groups: Record<string, string | undefined>,
  provider?: Provider,
): Segment | null {
  if (groups.url !== undefined) {
    const href = safeHttpUrl(body.startsWith("www.") ? `https://${body}` : body);
    return href ? { kind: "link", at, text: body, href } : null;
  }
  if (groups.time !== undefined) {
    if (provider !== "youtube") return null;
    const seconds = parseTimecode(body);
    return seconds === null ? null : { kind: "time", at, text: body, seconds };
  }
  if (groups.tag !== undefined && provider === "youtube") {
    const name = body.slice(1);
    const href = body.startsWith("#")
      ? `https://www.youtube.com/hashtag/${encodeURIComponent(name.toLowerCase())}`
      : `https://www.youtube.com/@${encodeURIComponent(name)}`;
    return { kind: "tag", at, text: body, href };
  }
  return null;
}
