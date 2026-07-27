import { describe, expect, it } from "vitest";
import { liveChatPopoutUrl, liveChatUrl, normalizeEmbedDomain } from "./youtube";

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
