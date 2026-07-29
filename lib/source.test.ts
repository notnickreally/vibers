import { describe, expect, it } from "vitest";
import {
  chatFrameUrl,
  chatPopoutUrl,
  decodeKeySegment,
  embedFor,
  isSourceKey,
  parseKey,
  parseSource,
  posterFor,
  providerOf,
  sourceKey,
  sourceNoun,
  watchHref,
  watchLinkUrl,
} from "./source";

/**
 * The seam between the two platforms — and the promise that adding one didn't
 * move the other.
 *
 * The load-bearing case is the first `describe`: every YouTube id already in
 * Neon, and every `/watch/<id>` link already shared, has to keep resolving with
 * no migration behind it. If those go, so does the wall.
 */

const YT = "dQw4w9WgXcQ";
const LOGIN = "theprimeagen";
const VOD = "2189123456";
const CLIP = "SpicyCrunchyPandaKappa-9x8y7z6w5v4u3t2s";

describe("the key format is the compatibility promise", () => {
  it("keeps a YouTube id bare, exactly as it is stored today", () => {
    expect(sourceKey({ provider: "youtube", id: YT })).toBe(YT);
    expect(parseKey(YT)).toEqual({ provider: "youtube", id: YT });
    expect(providerOf(YT)).toBe("youtube");
    expect(watchHref(YT)).toBe(`/watch/${YT}`);
  });

  it("carries the provider in front of everything else", () => {
    const key = sourceKey({ provider: "twitch", kind: "channel", id: LOGIN });
    expect(key).toBe(`twitch:channel:${LOGIN}`);
    expect(providerOf(key)).toBe("twitch");
    expect(parseKey(key)).toEqual({ provider: "twitch", kind: "channel", id: LOGIN });
  });

  it("encodes the key into a path — a Twitch one carries colons", () => {
    expect(watchHref("twitch:channel:theprimeagen")).toBe("/watch/twitch%3Achannel%3Atheprimeagen");
  });

  it("round-trips through the path, which Next hands back still encoded", () => {
    for (const key of [YT, `twitch:channel:${LOGIN}`, `twitch:clip:${CLIP}`]) {
      const segment = watchHref(key).slice("/watch/".length);
      expect(decodeKeySegment(segment)).toBe(key);
    }
  });

  it("makes an undecodable segment a null rather than a throw", () => {
    expect(decodeKeySegment("%E0%A4%A")).toBeNull();
    expect(decodeKeySegment("%")).toBeNull();
  });

  it("round-trips every source through the key and back", () => {
    for (const source of [
      { provider: "youtube", id: YT },
      { provider: "twitch", kind: "channel", id: LOGIN },
      { provider: "twitch", kind: "video", id: VOD },
      { provider: "twitch", kind: "clip", id: CLIP },
    ] as const) {
      expect(parseKey(sourceKey(source))).toEqual(source);
    }
  });

  it("says no to a key it can't validate, so nothing is built from it", () => {
    expect(parseKey("")).toBeNull();
    expect(parseKey("not a key")).toBeNull();
    expect(parseKey("twitch:channel:")).toBeNull();
    expect(parseKey("twitch:video:abc")).toBeNull();
    expect(isSourceKey(YT)).toBe(true);
    expect(isSourceKey("../etc/passwd")).toBe(false);
    expect(providerOf("nope")).toBeNull();
  });
});

describe("parseSource", () => {
  it("reads a pasted link from either platform", () => {
    expect(parseSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({
      provider: "youtube",
      id: YT,
    });
    expect(parseSource("https://www.twitch.tv/theprimeagen")).toMatchObject({
      provider: "twitch",
      kind: "channel",
      id: LOGIN,
    });
    expect(parseSource(`https://www.twitch.tv/videos/${VOD}`)).toMatchObject({
      provider: "twitch",
      kind: "video",
    });
  });

  it("gives a bare id to YouTube — it is the only one that takes one", () => {
    expect(parseSource(YT)).toEqual({ provider: "youtube", id: YT });
    expect(parseSource(LOGIN)).toBeNull();
  });

  it("takes a stored key from neither — that is parseKey's job", () => {
    expect(parseSource("twitch:channel:theprimeagen")).toBeNull();
  });

  it("refuses anything from neither platform", () => {
    expect(parseSource("")).toBeNull();
    expect(parseSource("https://vimeo.com/12345")).toBeNull();
  });
});

describe("embedFor", () => {
  it("builds a YouTube embed with no parent to ask for", () => {
    const url = embedFor({ provider: "youtube", id: YT });
    expect(url).toContain("https://www.youtube-nocookie.com/embed/");
    expect(url).toContain(YT);
  });

  it("passes the wall tile's chrome-free options through to YouTube", () => {
    const url = new URL(
      embedFor({ provider: "youtube", id: YT }, { autoplay: true, muted: true, controls: false }) ??
        "",
    );
    expect(url.searchParams.get("controls")).toBe("0");
    expect(url.searchParams.get("mute")).toBe("1");
    expect(url.searchParams.get("iv_load_policy")).toBe("3");
  });

  it("returns null for Twitch without a parent — a server render has no hostname", () => {
    expect(embedFor({ provider: "twitch", kind: "channel", id: LOGIN })).toBeNull();
    expect(
      embedFor({ provider: "twitch", kind: "channel", id: LOGIN }, { parent: "vibers.tv" }),
    ).toContain("player.twitch.tv");
  });
});

describe("the rest of the seam", () => {
  it("links out to each platform's own page", () => {
    expect(watchLinkUrl({ provider: "youtube", id: YT })).toBe(
      `https://www.youtube.com/watch?v=${YT}`,
    );
    expect(watchLinkUrl({ provider: "twitch", kind: "channel", id: LOGIN })).toBe(
      `https://www.twitch.tv/${LOGIN}`,
    );
  });

  it("has a poster for both", () => {
    expect(posterFor({ provider: "youtube", id: YT })).toContain(YT);
    expect(posterFor({ provider: "twitch", kind: "channel", id: LOGIN })).toContain(
      `live_user_${LOGIN}`,
    );
  });

  it("carries Twitch's chat and leaves YouTube's to the component", () => {
    expect(chatFrameUrl({ provider: "twitch", kind: "channel", id: LOGIN }, "vibers.tv")).toContain(
      `/embed/${LOGIN}/chat`,
    );
    expect(chatFrameUrl({ provider: "twitch", kind: "video", id: VOD }, "vibers.tv")).toBeNull();
    expect(chatFrameUrl({ provider: "youtube", id: YT }, "vibers.tv")).toBeNull();
    expect(chatPopoutUrl({ provider: "youtube", id: YT })).toBeNull();
  });

  it("names the thing behind a key the way a sentence would", () => {
    expect(sourceNoun({ provider: "youtube", id: YT })).toBe("video");
    expect(sourceNoun({ provider: "twitch", kind: "channel", id: LOGIN })).toBe("channel");
    expect(sourceNoun({ provider: "twitch", kind: "video", id: VOD })).toBe("VOD");
    expect(sourceNoun({ provider: "twitch", kind: "clip", id: CLIP })).toBe("clip");
  });
});
