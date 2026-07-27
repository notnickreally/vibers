import { describe, expect, it } from "vitest";
import {
  isVideoId,
  liveChatPopoutUrl,
  liveChatUrl,
  MAX_IDS,
  normalizeEmbedDomain,
  parseIds,
  safeHttpUrl,
} from "./youtube";

/**
 * The live chat frame either loads or refuses, and from the parent page those
 * two look identical — so every rule that decides which one happens is checked
 * here, where it is still observable. All pure string work, node environment,
 * same as the rest of the suite.
 */

const ID = "dQw4w9WgXcQ";

describe("normalizeEmbedDomain", () => {
  it("passes a plain hostname through", () => {
    expect(normalizeEmbedDomain("vibers.tv")).toBe("vibers.tv");
    expect(normalizeEmbedDomain("localhost")).toBe("localhost");
    expect(normalizeEmbedDomain("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeEmbedDomain("a-b.vercel.app")).toBe("a-b.vercel.app");
  });

  it("drops a port — YouTube matches on the hostname alone", () => {
    expect(normalizeEmbedDomain("localhost:3000")).toBe("localhost");
    expect(normalizeEmbedDomain("vibers.tv:8080")).toBe("vibers.tv");
  });

  it("lowercases and trims", () => {
    expect(normalizeEmbedDomain("  Vibers.TV  ")).toBe("vibers.tv");
  });

  it("does not invent a host out of a URL", () => {
    // The tempting bug is splitting on ":" and keeping "https".
    expect(normalizeEmbedDomain("https://vibers.tv")).toBeNull();
    expect(normalizeEmbedDomain("https:vibers.tv")).toBeNull();
    expect(normalizeEmbedDomain("vibers.tv/watch")).toBeNull();
    expect(normalizeEmbedDomain("user@vibers.tv")).toBeNull();
    expect(normalizeEmbedDomain("vibers.tv?v=1")).toBeNull();
    expect(normalizeEmbedDomain("vibers.tv#x")).toBeNull();
  });

  it("rejects anything that isn't hostname-shaped", () => {
    expect(normalizeEmbedDomain("")).toBeNull();
    expect(normalizeEmbedDomain("   ")).toBeNull();
    expect(normalizeEmbedDomain("vibers tv")).toBeNull();
    expect(normalizeEmbedDomain("<script>")).toBeNull();
    expect(normalizeEmbedDomain(".vibers.tv")).toBeNull();
    expect(normalizeEmbedDomain("vibers.tv.")).toBeNull();
    expect(normalizeEmbedDomain("vibers..tv")).toBeNull();
    expect(normalizeEmbedDomain("vibers.tv:notaport")).toBeNull();
    expect(normalizeEmbedDomain("a:1:2")).toBeNull();
    expect(normalizeEmbedDomain(`${"a".repeat(254)}.tv`)).toBeNull();
  });
});

describe("liveChatUrl", () => {
  it("builds the framable chat URL", () => {
    const url = liveChatUrl(ID, "vibers.tv");
    expect(url).toBe(
      `https://www.youtube.com/live_chat?v=${ID}&embed_domain=vibers.tv&dark_theme=1`,
    );
  });

  it("uses www.youtube.com — nocookie does not serve live chat", () => {
    expect(liveChatUrl(ID, "vibers.tv")).toContain("https://www.youtube.com/");
    expect(liveChatUrl(ID, "vibers.tv")).not.toContain("nocookie");
  });

  it("asks for the dark chat, so it doesn't glare inside the panel", () => {
    expect(liveChatUrl(ID, "vibers.tv")).toContain("dark_theme=1");
  });

  it("carries the port-stripped host", () => {
    expect(liveChatUrl(ID, "localhost:3000")).toBe(
      `https://www.youtube.com/live_chat?v=${ID}&embed_domain=localhost&dark_theme=1`,
    );
  });

  it("refuses an id that isn't a video id", () => {
    expect(liveChatUrl("", "vibers.tv")).toBeNull();
    expect(liveChatUrl("dQw4w9WgXc", "vibers.tv")).toBeNull(); // 10
    expect(liveChatUrl("dQw4w9WgXcQQ", "vibers.tv")).toBeNull(); // 12
    expect(liveChatUrl("../../etc/pw", "vibers.tv")).toBeNull();
    expect(liveChatUrl("dQw4w9WgXc&", "vibers.tv")).toBeNull();
  });

  it("refuses a host YouTube would never match", () => {
    expect(liveChatUrl(ID, "")).toBeNull();
    expect(liveChatUrl(ID, "https://vibers.tv")).toBeNull();
    expect(liveChatUrl(ID, "vibers.tv/x")).toBeNull();
  });

  it("cannot be talked into extra query parameters", () => {
    // Both inputs are validated before they are ever interpolated, so a
    // crafted one is rejected outright rather than escaped and shipped.
    expect(liveChatUrl("abc&foo=bar1", "vibers.tv")).toBeNull();
    expect(liveChatUrl(ID, "vibers.tv&foo=bar")).toBeNull();
  });
});

describe("liveChatPopoutUrl", () => {
  it("builds a chat URL that stands up as its own page", () => {
    expect(liveChatPopoutUrl(ID)).toBe(
      `https://www.youtube.com/live_chat?v=${ID}&is_popout=1`,
    );
  });

  it("refuses a bad id rather than linking somewhere odd", () => {
    expect(liveChatPopoutUrl("nope")).toBeNull();
    expect(liveChatPopoutUrl("")).toBeNull();
  });
});

describe("isVideoId", () => {
  it("takes the eleven characters YouTube actually uses", () => {
    expect(isVideoId(ID)).toBe(true);
    expect(isVideoId("_-aA0123456")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "short", `${ID}x`, "abcdefghij!", "abc def ghi"]) {
      expect(isVideoId(bad)).toBe(false);
    }
  });
});

describe("parseIds", () => {
  it("reads a comma-separated list", () => {
    expect(parseIds(`${ID},jfKfPfyJRdk`)).toEqual([ID, "jfKfPfyJRdk"]);
  });

  it("tolerates whitespace around the commas", () => {
    expect(parseIds(` ${ID} , jfKfPfyJRdk `)).toEqual([ID, "jfKfPfyJRdk"]);
  });

  it("answers empty for nothing at all", () => {
    expect(parseIds(null)).toEqual([]);
    expect(parseIds("")).toEqual([]);
  });

  // These ids are interpolated into a URL handed to Google, so anything that
  // isn't recognisably an id is dropped rather than escaped and sent on.
  it("drops anything that isn't a video id instead of escaping it", () => {
    expect(parseIds(`${ID},&key=stolen,../../etc,nope`)).toEqual([ID]);
    expect(parseIds("&part=snippet")).toEqual([]);
  });

  // Otherwise one repeated id could spend the day's quota in a single call.
  it("collapses duplicates", () => {
    expect(parseIds(`${ID},${ID},${ID}`)).toEqual([ID]);
  });

  it("caps at the number videos.list will accept", () => {
    // Eleven characters each, or parseIds would rightly drop the lot.
    const many = Array.from({ length: 80 }, (_, i) => `id${String(i).padStart(9, "0")}`);
    expect(parseIds(many.join(","))).toHaveLength(MAX_IDS);
  });

  it("honours a smaller cap when asked", () => {
    expect(parseIds(`${ID},jfKfPfyJRdk`, 1)).toEqual([ID]);
  });
});

describe("safeHttpUrl", () => {
  it("passes an ordinary channel link through", () => {
    expect(safeHttpUrl("https://www.youtube.com/@lofigirl")).toBe(
      "https://www.youtube.com/@lofigirl",
    );
    expect(safeHttpUrl("http://example.com/")).toBe("http://example.com/");
  });

  // The wall lives in localStorage, which is the reader's own to edit, so what
  // reaches an href is whatever is in the store — not necessarily what oEmbed
  // handed us. Only http(s) survives.
  it("refuses a scheme that would run instead of navigate", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("refuses what isn't a URL at all", () => {
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
});
