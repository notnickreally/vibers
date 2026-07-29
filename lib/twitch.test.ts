import { describe, expect, it } from "vitest";
import {
  formatStart,
  isTwitchKey,
  normalizeParent,
  parseTwitch,
  parseTwitchKey,
  TWITCH_NO_PREVIEW,
  twitchChatPopoutUrl,
  twitchChatUrl,
  twitchEmbedUrl,
  twitchKey,
  twitchPosterUrl,
  twitchWatchUrl,
} from "./twitch";

/**
 * Twitch's half of the wall, pinned where it is still observable.
 *
 * Two of the rules below are the ones that bite in production and cannot be
 * seen from the outside: a frame built without a `parent` comes back refused
 * with no error to catch, and a key that round-trips wrong points a tile at a
 * channel nobody asked for. Both are pure string work, so both are checked
 * here rather than in a browser.
 */

const LOGIN = "theprimeagen";
const VOD = "2189123456";
const CLIP = "SpicyCrunchyPandaKappa-9x8y7z6w5v4u3t2s";

describe("parseTwitch", () => {
  it("takes a plain channel URL", () => {
    expect(parseTwitch("https://www.twitch.tv/theprimeagen")).toEqual({
      kind: "channel",
      id: LOGIN,
    });
    expect(parseTwitch("twitch.tv/theprimeagen")).toEqual({ kind: "channel", id: LOGIN });
    expect(parseTwitch("https://m.twitch.tv/theprimeagen")).toEqual({
      kind: "channel",
      id: LOGIN,
    });
  });

  it("lowercases the login — the URL is case-insensitive, the key is not", () => {
    expect(parseTwitch("https://twitch.tv/ThePrimeagen")).toEqual({
      kind: "channel",
      id: LOGIN,
    });
  });

  it("takes a VOD, in both of the spellings Twitch hands out", () => {
    expect(parseTwitch(`https://www.twitch.tv/videos/${VOD}`)).toEqual({
      kind: "video",
      id: VOD,
      start: undefined,
    });
    expect(parseTwitch(`https://www.twitch.tv/${LOGIN}/v/${VOD}`)).toEqual({
      kind: "video",
      id: VOD,
      start: undefined,
    });
    expect(parseTwitch(`https://www.twitch.tv/videos/v${VOD}`)?.id).toBe(VOD);
  });

  it("carries a VOD timestamp, and only in Twitch's own spelling", () => {
    expect(parseTwitch(`https://www.twitch.tv/videos/${VOD}?t=1h2m3s`)?.start).toBe(3723);
    expect(parseTwitch(`https://www.twitch.tv/videos/${VOD}?t=90s`)?.start).toBe(90);
    // YouTube's bare-seconds form is not Twitch's, and guessing would seek wrong.
    expect(parseTwitch(`https://www.twitch.tv/videos/${VOD}?t=90`)?.start).toBeUndefined();
    expect(parseTwitch(`https://www.twitch.tv/videos/${VOD}?t=0s`)?.start).toBeUndefined();
  });

  it("takes a clip from either of its two hosts", () => {
    expect(parseTwitch(`https://clips.twitch.tv/${CLIP}`)).toEqual({ kind: "clip", id: CLIP });
    expect(parseTwitch(`https://www.twitch.tv/${LOGIN}/clip/${CLIP}`)).toEqual({
      kind: "clip",
      id: CLIP,
    });
    expect(parseTwitch(`https://clips.twitch.tv/embed?clip=${CLIP}&parent=vibers.tv`)).toEqual({
      kind: "clip",
      id: CLIP,
    });
  });

  it("takes the embed URLs back, so a copied frame source still works", () => {
    expect(parseTwitch(`https://player.twitch.tv/?channel=${LOGIN}&parent=vibers.tv`)).toEqual({
      kind: "channel",
      id: LOGIN,
    });
    expect(parseTwitch(`https://player.twitch.tv/?video=${VOD}&parent=vibers.tv`)).toEqual({
      kind: "video",
      id: VOD,
      start: undefined,
    });
    expect(parseTwitch(`https://www.twitch.tv/embed/${LOGIN}/chat?parent=vibers.tv`)).toEqual({
      kind: "channel",
      id: LOGIN,
    });
  });

  it("refuses Twitch's own pages, which parse as perfectly good logins", () => {
    expect(parseTwitch("https://www.twitch.tv/directory")).toBeNull();
    expect(parseTwitch("https://www.twitch.tv/settings")).toBeNull();
    expect(parseTwitch("https://www.twitch.tv/Directory")).toBeNull();
    // A deeper path is one of Twitch's pages about a channel, not the stream.
    expect(parseTwitch(`https://www.twitch.tv/${LOGIN}/about`)).toBeNull();
    expect(parseTwitch(`https://www.twitch.tv/${LOGIN}/schedule`)).toBeNull();
  });

  it("refuses a bare login — too many things are also words", () => {
    expect(parseTwitch(LOGIN)).toBeNull();
    expect(parseTwitch("nasa")).toBeNull();
  });

  it("refuses anything that isn't Twitch", () => {
    expect(parseTwitch("")).toBeNull();
    expect(parseTwitch("   ")).toBeNull();
    expect(parseTwitch("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseTwitch("https://twitch.tv.evil.example/theprimeagen")).toBeNull();
    expect(parseTwitch("https://nottwitch.tv/theprimeagen")).toBeNull();
    expect(parseTwitch("https://www.twitch.tv/videos/not-a-number")).toBeNull();
    expect(parseTwitch("https://www.twitch.tv/thisloginiswaytoolongtobearealtwitchlogin")).toBeNull();
    expect(parseTwitch("https://www.twitch.tv/has spaces")).toBeNull();
  });
});

describe("the stored key", () => {
  it("round-trips every kind", () => {
    for (const source of [
      { kind: "channel", id: LOGIN },
      { kind: "video", id: VOD },
      { kind: "clip", id: CLIP },
    ] as const) {
      expect(parseTwitchKey(twitchKey(source))).toEqual(source);
    }
  });

  it("keeps the timestamp out — the key names the thing, not the moment", () => {
    const source = parseTwitch(`https://www.twitch.tv/videos/${VOD}?t=1h0m0s`);
    if (!source) throw new Error("expected a VOD");
    expect(source.start).toBe(3600);
    expect(parseTwitchKey(twitchKey(source))).toEqual({ kind: "video", id: VOD });
  });

  it("marks its own keys and claims nothing else", () => {
    expect(isTwitchKey(twitchKey({ kind: "channel", id: LOGIN }))).toBe(true);
    // A bare YouTube id must stay YouTube's — that is the migration promise.
    expect(isTwitchKey("dQw4w9WgXcQ")).toBe(false);
    expect(isTwitchKey("")).toBe(false);
  });

  it("validates rather than trusts — a key travels through the database", () => {
    expect(parseTwitchKey("dQw4w9WgXcQ")).toBeNull();
    expect(parseTwitchKey("twitch:")).toBeNull();
    expect(parseTwitchKey("twitch:channel:")).toBeNull();
    expect(parseTwitchKey("twitch:channel")).toBeNull();
    expect(parseTwitchKey("twitch:nonsense:x")).toBeNull();
    expect(parseTwitchKey("twitch:video:abc")).toBeNull();
    expect(parseTwitchKey("twitch:channel:has spaces")).toBeNull();
    expect(parseTwitchKey('twitch:channel:x"onerror=')).toBeNull();
  });
});

describe("normalizeParent", () => {
  it("passes a hostname through, and drops the port Twitch adds itself", () => {
    expect(normalizeParent("vibers.tv")).toBe("vibers.tv");
    expect(normalizeParent("localhost:3000")).toBe("localhost");
    expect(normalizeParent("  Vibers.TV  ")).toBe("vibers.tv");
  });

  it("does not invent a host out of a URL", () => {
    expect(normalizeParent("https://vibers.tv")).toBeNull();
    expect(normalizeParent("vibers.tv/watch")).toBeNull();
    expect(normalizeParent("user@vibers.tv")).toBeNull();
    expect(normalizeParent("")).toBeNull();
    expect(normalizeParent("a:1:2")).toBeNull();
    expect(normalizeParent("vibers.tv:notaport")).toBeNull();
  });
});

describe("twitchEmbedUrl", () => {
  it("puts the parent on every frame — without it Twitch refuses", () => {
    const url = twitchEmbedUrl({ kind: "channel", id: LOGIN }, "localhost:3000");
    expect(url).toContain("https://player.twitch.tv/?");
    expect(new URL(url ?? "").searchParams.get("parent")).toBe("localhost");
    expect(new URL(url ?? "").searchParams.get("channel")).toBe(LOGIN);
  });

  it("returns null rather than a URL that would load a refusal", () => {
    expect(twitchEmbedUrl({ kind: "channel", id: LOGIN }, "https://vibers.tv")).toBeNull();
    expect(twitchEmbedUrl({ kind: "channel", id: LOGIN }, "")).toBeNull();
  });

  it("sends a clip to the clip host, which is Twitch's arrangement", () => {
    const url = twitchEmbedUrl({ kind: "clip", id: CLIP }, "vibers.tv");
    expect(url).toContain("https://clips.twitch.tv/embed?");
    expect(new URL(url ?? "").searchParams.get("clip")).toBe(CLIP);
  });

  it("carries a VOD's start in the only spelling the player accepts", () => {
    const url = twitchEmbedUrl({ kind: "video", id: VOD, start: 3723 }, "vibers.tv");
    expect(new URL(url ?? "").searchParams.get("time")).toBe("1h2m3s");
    expect(new URL(url ?? "").searchParams.get("video")).toBe(VOD);
  });

  it("takes autoplay, mute and controls as the caller asks", () => {
    const tile = new URL(
      twitchEmbedUrl({ kind: "channel", id: LOGIN }, "vibers.tv", {
        autoplay: true,
        muted: true,
        controls: false,
      }) ?? "",
    );
    expect(tile.searchParams.get("muted")).toBe("true");
    expect(tile.searchParams.get("controls")).toBe("false");

    const watch = new URL(
      twitchEmbedUrl({ kind: "channel", id: LOGIN }, "vibers.tv", {
        muted: false,
        controls: true,
      }) ?? "",
    );
    expect(watch.searchParams.get("muted")).toBe("false");
    expect(watch.searchParams.get("controls")).toBe("true");
  });
});

describe("chat", () => {
  it("frames a channel's chat under the parent", () => {
    const url = twitchChatUrl({ kind: "channel", id: LOGIN }, "vibers.tv");
    expect(url).toContain(`https://www.twitch.tv/embed/${LOGIN}/chat?`);
    expect(new URL(url ?? "").searchParams.get("parent")).toBe("vibers.tv");
  });

  it("has none for a VOD or a clip, and says so instead of guessing", () => {
    expect(twitchChatUrl({ kind: "video", id: VOD }, "vibers.tv")).toBeNull();
    expect(twitchChatUrl({ kind: "clip", id: CLIP }, "vibers.tv")).toBeNull();
    expect(twitchChatPopoutUrl({ kind: "video", id: VOD })).toBeNull();
    expect(twitchChatPopoutUrl({ kind: "clip", id: CLIP })).toBeNull();
  });

  it("refuses to frame chat without a usable parent", () => {
    expect(twitchChatUrl({ kind: "channel", id: LOGIN }, "https://vibers.tv")).toBeNull();
  });

  it("pops out to the channel's own chat page", () => {
    expect(twitchChatPopoutUrl({ kind: "channel", id: LOGIN })).toBe(
      `https://www.twitch.tv/popout/${LOGIN}/chat`,
    );
  });
});

describe("links out and posters", () => {
  it("points at where each kind actually lives on Twitch", () => {
    expect(twitchWatchUrl({ kind: "channel", id: LOGIN })).toBe(`https://www.twitch.tv/${LOGIN}`);
    expect(twitchWatchUrl({ kind: "video", id: VOD })).toBe(
      `https://www.twitch.tv/videos/${VOD}`,
    );
    expect(twitchWatchUrl({ kind: "clip", id: CLIP })).toBe(`https://clips.twitch.tv/${CLIP}`);
  });

  it("uses the live preview for a channel and a 16:9 stand-in for the rest", () => {
    expect(twitchPosterUrl({ kind: "channel", id: LOGIN })).toBe(
      `https://static-cdn.jtvnw.net/previews-ttv/live_user_${LOGIN}-1280x720.jpg`,
    );
    expect(twitchPosterUrl({ kind: "video", id: VOD })).toBe(TWITCH_NO_PREVIEW);
    expect(twitchPosterUrl({ kind: "clip", id: CLIP })).toBe(TWITCH_NO_PREVIEW);
  });
});

describe("formatStart", () => {
  it("writes the player's spelling, and never a negative one", () => {
    expect(formatStart(0)).toBe("0h0m0s");
    expect(formatStart(3723)).toBe("1h2m3s");
    expect(formatStart(59.9)).toBe("0h0m59s");
    expect(formatStart(-5)).toBe("0h0m0s");
  });
});
