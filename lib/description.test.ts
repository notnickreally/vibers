import { describe, expect, it } from "vitest";
import { parseTimecode, readDescription, type Segment, tidy } from "./description";

/**
 * What the description is allowed to do to a channel's words.
 *
 * Two promises are pinned here, and they pull in opposite directions. The
 * first is that runs which mean something become clickable — a link, a chapter
 * mark, a tag — because that is the whole feature. The second is that nothing
 * else is touched: the site says underneath the description that it shows it as
 * published, and every case below where a segment comes back as `text` is that
 * promise being kept against something that looked like a link and wasn't.
 *
 * The `javascript:` case is the one that is not about typography at all. A
 * description is a third party's text on everyone's screen, so a scheme that
 * isn't http(s) has to come out the far end as characters.
 */

const YT = "youtube" as const;

/** The rendered text, so a case can assert the words survived the markup. */
function flatten(segments: Segment[]): string {
  return segments.map((s) => s.text).join("");
}

function kinds(segments: Segment[]): string[] {
  return segments.map((s) => s.kind);
}

describe("tidy", () => {
  it("decodes the entities the Twitch scrape leaves behind", () => {
    expect(tidy("it&#39;s live &amp; loud")).toBe("it's live & loud");
    expect(tidy("three&hellip; two&#8230;")).toBe("three… two…");
    expect(tidy("hard&nbsp;space")).toBe("hard space");
  });

  it("decodes once, so a literal entity in the text stays literal", () => {
    expect(tidy("write &amp;#39; to get an apostrophe")).toBe("write &#39; to get an apostrophe");
  });

  it("leaves an unknown or malformed entity exactly as written", () => {
    expect(tidy("A&B &notreal; &#; &#999999999;")).toBe("A&B &notreal; &#; &#999999999;");
  });

  it("collapses the blank screens channels pad descriptions with", () => {
    expect(tidy("top\n\n\n\n\n\nbottom")).toBe("top\n\nbottom");
  });

  it("keeps a real paragraph break", () => {
    expect(tidy("one\n\ntwo")).toBe("one\n\ntwo");
  });

  it("normalises line endings and strips the whitespace on the ends of lines", () => {
    expect(tidy("  one   \r\n  two  \r\n")).toBe("one\n  two");
  });

  it("is empty for nothing at all", () => {
    expect(tidy(undefined)).toBe("");
    expect(tidy("   \n\n  ")).toBe("");
    expect(readDescription(undefined, YT)).toEqual([]);
  });
});

describe("parseTimecode", () => {
  it("reads the spellings a description actually uses", () => {
    expect(parseTimecode("0:00")).toBe(0);
    expect(parseTimecode("12:34")).toBe(754);
    expect(parseTimecode("1:02:03")).toBe(3723);
  });

  it("refuses anything match-shaped that means nothing", () => {
    expect(parseTimecode("1:75")).toBeNull();
    expect(parseTimecode("1:99:00")).toBeNull();
    expect(parseTimecode("12")).toBeNull();
    expect(parseTimecode("1:2:3:4")).toBeNull();
  });
});

describe("readDescription", () => {
  it("marks a bare URL up as a link and leaves the sentence around it", () => {
    const segments = readDescription("repo: https://github.com/me/thing — have a look", YT);
    expect(kinds(segments)).toEqual(["text", "link", "text"]);
    expect(segments[1]).toMatchObject({
      kind: "link",
      text: "https://github.com/me/thing",
      href: "https://github.com/me/thing",
    });
  });

  it("gives a bare www. host a scheme without changing what is shown", () => {
    const [segment] = readDescription("www.example.com", YT);
    expect(segment).toMatchObject({
      kind: "link",
      text: "www.example.com",
      href: "https://www.example.com/",
    });
  });

  it("leaves the punctuation after a link outside it", () => {
    const segments = readDescription("(see https://example.com/a).", YT);
    expect(segments[1]).toMatchObject({ text: "https://example.com/a" });
    expect(flatten(segments)).toBe("(see https://example.com/a).");
  });

  it("keeps a bracket the URL itself opened", () => {
    const [segment] = readDescription(
      "https://en.wikipedia.org/wiki/Rust_(programming_language)",
      YT,
    );
    expect(segment).toMatchObject({
      text: "https://en.wikipedia.org/wiki/Rust_(programming_language)",
    });
  });

  it("renders a scheme that isn't http(s) as characters, never as an href", () => {
    const segments = readDescription("click javascript:alert(1) now", YT);
    expect(kinds(segments)).toEqual(["text"]);
    expect(flatten(segments)).toBe("click javascript:alert(1) now");
  });

  it("turns chapter marks into seeks, at the second they name", () => {
    const segments = readDescription("00:00 intro\n12:34 the bug\n1:02:03 the fix", YT);
    expect(segments.filter((s) => s.kind === "time")).toEqual([
      { kind: "time", at: 0, text: "00:00", seconds: 0 },
      { kind: "time", at: 12, text: "12:34", seconds: 754 },
      { kind: "time", at: 26, text: "1:02:03", seconds: 3723 },
    ]);
  });

  it("leaves a number pair that isn't a time as text", () => {
    expect(kinds(readDescription("final score 6:4, and 1:75 is not a time", YT))).toEqual(["text"]);
  });

  it("does not find a chapter mark inside a link", () => {
    const segments = readDescription("https://example.com/12:34/x", YT);
    expect(kinds(segments)).toEqual(["link"]);
  });

  it("links hashtags and handles to the platform's own pages", () => {
    const segments = readDescription("#buildInPublic with @theprimeagen", YT);
    expect(segments.filter((s) => s.kind === "tag")).toEqual([
      {
        kind: "tag",
        at: 0,
        text: "#buildInPublic",
        href: "https://www.youtube.com/hashtag/buildinpublic",
      },
      {
        kind: "tag",
        at: 20,
        text: "@theprimeagen",
        href: "https://www.youtube.com/@theprimeagen",
      },
    ]);
  });

  it("leaves the @ in an email address alone", () => {
    expect(kinds(readDescription("write to me@example.com", YT))).toEqual(["text"]);
  });

  it("only makes clickable what the platform can act on", () => {
    // Twitch's embed is Twitch's own player with no JS API to seek, and there
    // are no hashtag pages to send a tag to — so both stay words. A link is
    // still a link, because a link goes to the web rather than to a platform.
    const twitch = readDescription("00:00 intro #tag https://example.com/a", "twitch");
    expect(kinds(twitch)).toEqual(["text", "link"]);
    expect(flatten(twitch)).toBe("00:00 intro #tag https://example.com/a");

    // No provider at all is the same answer for the same reason.
    expect(kinds(readDescription("00:00 intro #tag", undefined))).toEqual(["text"]);
  });

  it("never loses or invents a character, whatever it marks up", () => {
    const raw =
      "Day 14.\n\n\n\nRepo: https://github.com/me/thing\n00:00 intro\n12:34 the bug\n#buildinpublic";
    const segments = readDescription(raw, YT);
    expect(flatten(segments)).toBe(tidy(raw));
  });

  it("hands out offsets that are unique, so the renderer has real keys", () => {
    const segments = readDescription("00:00 a https://example.com/a #tag @someone", YT);
    const keys = segments.map((s) => `${s.kind}-${s.at}`);
    expect(new Set(keys).size).toBe(segments.length);
  });
});
