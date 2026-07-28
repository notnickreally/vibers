import { describe, expect, it } from "vitest";
import {
  chunk,
  isLive,
  isVideoId,
  liveChatPopoutUrl,
  liveChatSignInUrl,
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

describe("liveChatSignInUrl", () => {
  it("signs in through YouTube's own redirector, landing on this chat", () => {
    expect(liveChatSignInUrl(ID)).toBe(
      `https://www.youtube.com/signin?next=%2Flive_chat%3Fv%3D${ID}%26is_popout%3D1`,
    );
  });

  it("keeps `next` a relative path on youtube.com", () => {
    // Two reasons, both load-bearing: YouTube only honours its own paths
    // there, and a relative one cannot be turned into an open redirect.
    const url = new URL(liveChatSignInUrl(ID) as string);
    expect(url.origin).toBe("https://www.youtube.com");
    expect(url.pathname).toBe("/signin");
    const next = url.searchParams.get("next") as string;
    expect(next.startsWith("/live_chat?")).toBe(true);
    expect(next.includes("//")).toBe(false);
  });

  it("asks for the pop-out, which is the only framing YouTube allows here", () => {
    // `live_chat` without `is_popout` does not stand up as a top-level page,
    // and the pop-out answers X-Frame-Options: SAMEORIGIN — so this URL is
    // only ever correct in a real window, never in the frame above it.
    const next = new URLSearchParams(
      new URL(liveChatSignInUrl(ID) as string).search,
    ).get("next") as string;
    const params = new URLSearchParams(next.slice(next.indexOf("?")));
    expect(params.get("v")).toBe(ID);
    expect(params.get("is_popout")).toBe("1");
  });

  it("refuses a bad id rather than opening a window on nothing", () => {
    expect(liveChatSignInUrl("nope")).toBeNull();
    expect(liveChatSignInUrl("")).toBeNull();
    expect(liveChatSignInUrl("../../etc/passwd")).toBeNull();
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

describe("chunk", () => {
  // The shape that matters: confirming a hundred candidates is two calls, not a
  // hundred. One request per candidate is the N+1 this exists to make impossible.
  it("splits a candidate set into batches videos.list will take", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `id${i}`);
    const batches = chunk(ids, MAX_IDS);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(50);
    expect(batches[1]).toHaveLength(50);
  });

  it("leaves a short set in one batch", () => {
    expect(chunk(["a", "b"], MAX_IDS)).toEqual([["a", "b"]]);
    expect(chunk(Array.from({ length: 51 }, (_, i) => i), MAX_IDS)[1]).toHaveLength(1);
  });

  it("is total over nothing to batch", () => {
    expect(chunk([], MAX_IDS)).toEqual([]);
    expect(chunk(undefined as unknown as string[], MAX_IDS)).toEqual([]);
    // A size that would loop forever answers with nothing instead.
    expect(chunk(["a"], 0)).toEqual([]);
    expect(chunk(["a"], -1)).toEqual([]);
  });
});

describe("isLive", () => {
  const started = "2026-07-28T09:00:00Z";

  it("says yes only to a broadcast that started and has not ended", () => {
    expect(
      isLive({
        snippet: { liveBroadcastContent: "live" },
        liveStreamingDetails: { actualStartTime: started },
      }),
    ).toBe(true);
  });

  it("says no to a broadcast that finished", () => {
    expect(
      isLive({
        snippet: { liveBroadcastContent: "live" },
        liveStreamingDetails: { actualStartTime: started, actualEndTime: "2026-07-28T11:00:00Z" },
      }),
    ).toBe(false);
  });

  // A premiere scheduled for tomorrow is not live, and the field that says so
  // is the missing start time — `actualStartTime` is absent until it begins.
  it("says no to a broadcast that has not started", () => {
    expect(
      isLive({
        snippet: { liveBroadcastContent: "upcoming" },
        liveStreamingDetails: {},
      }),
    ).toBe(false);
  });

  // YouTube only carries liveStreamingDetails for something that was once a
  // broadcast, so its absence is what separates a plain video from a stream.
  it("says no to a video that was never a broadcast", () => {
    expect(isLive({ snippet: { liveBroadcastContent: "none" } })).toBe(false);
  });

  it("is total over junk", () => {
    for (const junk of [undefined, null, {}, { snippet: 3 }, { liveStreamingDetails: "x" }, []]) {
      expect(isLive(junk as never)).toBe(false);
    }
  });
});
