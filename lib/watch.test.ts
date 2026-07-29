import { describe, expect, it } from "vitest";
import {
  channelUrl,
  feedUrl,
  MAX_PER_CHANNEL,
  parseWatchInput,
  parseWatchKey,
  readFeedIds,
  streamKeyFor,
  watchKey,
} from "./watch";

/**
 * The watchlist, minus the asking.
 *
 * What matters here is the promise the feature makes to a wall everybody can
 * see: a pasted username becomes exactly the channel it names, or it becomes
 * nothing. So the refusals are pinned as carefully as the acceptances — a bare
 * word with no platform, one of the platform's own routes, a video link where a
 * channel was expected. Each of those, waved through, is somebody else's stream
 * on everyone's screen.
 */

const CHANNEL = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

describe("parseWatchInput", () => {
  it("takes a YouTube channel link", () => {
    expect(parseWatchInput(`https://www.youtube.com/channel/${CHANNEL}`)).toEqual({
      provider: "youtube",
      by: "id",
      value: CHANNEL,
    });
  });

  it("takes a YouTube handle link, with or without the scheme", () => {
    const expected = { provider: "youtube", by: "handle", value: "ThePrimeagen" };
    expect(parseWatchInput("https://www.youtube.com/@ThePrimeagen")).toEqual(expected);
    expect(parseWatchInput("youtube.com/@ThePrimeagen")).toEqual(expected);
    // A deeper path is still the same channel — `/@name/live`, `/@name/streams`.
    expect(parseWatchInput("https://youtube.com/@ThePrimeagen/live")).toEqual(expected);
  });

  it("takes the legacy /user and /c paths", () => {
    expect(parseWatchInput("https://www.youtube.com/user/GoogleDevelopers")).toEqual({
      provider: "youtube",
      by: "user",
      value: "GoogleDevelopers",
    });
    expect(parseWatchInput("https://www.youtube.com/c/GoogleDevelopers")).toEqual({
      provider: "youtube",
      by: "user",
      value: "GoogleDevelopers",
    });
  });

  it("takes a Twitch channel link", () => {
    expect(parseWatchInput("https://www.twitch.tv/ThePrimeagen")).toEqual({
      provider: "twitch",
      by: "login",
      value: "theprimeagen",
    });
  });

  it("takes a bare handle or channel id without being told the platform", () => {
    expect(parseWatchInput("@ThePrimeagen")).toEqual({
      provider: "youtube",
      by: "handle",
      value: "ThePrimeagen",
    });
    expect(parseWatchInput(CHANNEL)).toEqual({ provider: "youtube", by: "id", value: CHANNEL });
  });

  it("refuses a bare word when nothing says which platform it is", () => {
    // `someone` is a plausible Twitch login and a plausible YouTube handle.
    // Guessing puts the wrong person on a wall everybody can see.
    expect(parseWatchInput("someone")).toBeNull();
  });

  it("reads a bare word under the platform the panel was on", () => {
    expect(parseWatchInput("someone", "twitch")).toEqual({
      provider: "twitch",
      by: "login",
      value: "someone",
    });
    expect(parseWatchInput("someone", "youtube")).toEqual({
      provider: "youtube",
      by: "handle",
      value: "someone",
    });
  });

  it("lets a link outrank the platform the panel was on", () => {
    expect(parseWatchInput("https://www.twitch.tv/someone", "youtube")).toEqual({
      provider: "twitch",
      by: "login",
      value: "someone",
    });
    expect(parseWatchInput("https://www.youtube.com/@someone", "twitch")).toEqual({
      provider: "youtube",
      by: "handle",
      value: "someone",
    });
  });

  it("lowercases a Twitch login and leaves a YouTube handle alone", () => {
    // Twitch logins are case-insensitive and the API keys on the lowercase
    // form; YouTube handles are shown as typed.
    expect(parseWatchInput("https://twitch.tv/ThePrimeagen")?.value).toBe("theprimeagen");
    expect(parseWatchInput("@ThePrimeagen")?.value).toBe("ThePrimeagen");
  });

  it("refuses a video link on either platform", () => {
    expect(parseWatchInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseWatchInput("https://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(parseWatchInput("https://www.twitch.tv/videos/123456")).toBeNull();
    expect(parseWatchInput("https://clips.twitch.tv/SomeClipSlug")).toBeNull();
  });

  it("refuses the platforms' own routes", () => {
    expect(parseWatchInput("https://www.youtube.com/feed/subscriptions")).toBeNull();
    expect(parseWatchInput("https://www.twitch.tv/directory")).toBeNull();
    expect(parseWatchInput("directory", "twitch")).toBeNull();
  });

  it("refuses junk, other hosts and empty input", () => {
    expect(parseWatchInput("")).toBeNull();
    expect(parseWatchInput("   ")).toBeNull();
    expect(parseWatchInput("https://example.com/@someone")).toBeNull();
    expect(parseWatchInput("https://youtube.com")).toBeNull();
    expect(parseWatchInput("ht!tp:/[bad", "twitch")).toBeNull();
    expect(parseWatchInput("a".repeat(400), "twitch")).toBeNull();
    // Outside the login charset, so it never reaches a Twitch URL.
    expect(parseWatchInput("some one!", "twitch")).toBeNull();
  });

  it("is total over anything, not just over strings", () => {
    expect(parseWatchInput(undefined as unknown as string)).toBeNull();
    expect(parseWatchInput(null as unknown as string, "twitch")).toBeNull();
    expect(parseWatchInput(42 as unknown as string)).toBeNull();
  });
});

describe("watchKey", () => {
  it("round-trips both platforms", () => {
    for (const target of [
      { provider: "youtube", id: CHANNEL } as const,
      { provider: "twitch", id: "someone" } as const,
    ]) {
      expect(parseWatchKey(watchKey(target))).toEqual(target);
    }
  });

  it("validates rather than trusts what comes back out", () => {
    expect(parseWatchKey("youtube:not-a-channel-id")).toBeNull();
    expect(parseWatchKey("twitch:Some One")).toBeNull();
    expect(parseWatchKey("vimeo:someone")).toBeNull();
    expect(parseWatchKey("youtube")).toBeNull();
    expect(parseWatchKey(":someone")).toBeNull();
    expect(parseWatchKey(undefined as unknown as string)).toBeNull();
  });

  it("is a different namespace from the wall's own stream keys", () => {
    // A watched Twitch channel maps onto a stream key; a watched YouTube
    // channel has none, because a channel is not a video.
    expect(streamKeyFor({ provider: "twitch", id: "someone" })).toBe("twitch:channel:someone");
    expect(streamKeyFor({ provider: "youtube", id: CHANNEL })).toBeNull();
  });

  it("links out to the channel's own page", () => {
    expect(channelUrl({ provider: "twitch", id: "someone" })).toBe("https://www.twitch.tv/someone");
    expect(channelUrl({ provider: "youtube", id: CHANNEL })).toBe(
      `https://www.youtube.com/channel/${CHANNEL}`,
    );
  });
});

describe("feedUrl", () => {
  it("builds a feed URL only for a real channel id", () => {
    expect(feedUrl(CHANNEL)).toBe(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`,
    );
    expect(feedUrl("someone")).toBeNull();
    expect(feedUrl(`${CHANNEL}&extra=1`)).toBeNull();
  });
});

describe("readFeedIds", () => {
  const feed = `<?xml version="1.0"?>
    <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
      <entry><yt:videoId>dQw4w9WgXcQ</yt:videoId></entry>
      <entry><yt:videoId>jfKfPfyJRdk</yt:videoId></entry>
      <entry><yt:videoId>5qap5aO4i9A</yt:videoId></entry>
      <entry><yt:videoId>aaaaaaaaaaa</yt:videoId></entry>
    </feed>`;

  it("reads the ids, newest first, capped", () => {
    expect(readFeedIds(feed)).toEqual(["dQw4w9WgXcQ", "jfKfPfyJRdk", "5qap5aO4i9A"]);
    expect(readFeedIds(feed).length).toBeLessThanOrEqual(MAX_PER_CHANNEL);
    expect(readFeedIds(feed, 1)).toEqual(["dQw4w9WgXcQ"]);
  });

  it("drops anything that isn't an id, and collapses duplicates", () => {
    const messy = `
      <yt:videoId>not an id</yt:videoId>
      <yt:videoId>dQw4w9WgXcQ</yt:videoId>
      <yt:videoId>dQw4w9WgXcQ</yt:videoId>
      <yt:videoId></yt:videoId>
      <yt:videoId>toolongtobeanid</yt:videoId>`;
    expect(readFeedIds(messy)).toEqual(["dQw4w9WgXcQ"]);
  });

  it("is total over junk", () => {
    expect(readFeedIds("")).toEqual([]);
    expect(readFeedIds("<html>not a feed</html>")).toEqual([]);
    expect(readFeedIds(null)).toEqual([]);
    expect(readFeedIds({ items: [] })).toEqual([]);
  });
});
