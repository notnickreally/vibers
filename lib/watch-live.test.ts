import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `lib/watch-live.ts` is `server-only`, which throws outside a React Server
// Component. The suite is the third caller and wants the same functions, so the
// marker is stubbed rather than the module being split in half to avoid it.
vi.mock("server-only", () => ({}));

import { CONFIRM_TTL } from "./discover";
import { FEED_TTL, type Watched } from "./watch";
import { sweepWatchlist } from "./watch-live";

/**
 * The sweep's two YouTube legs, and how each one is allowed to be cached.
 *
 * The interesting thing about this file is not that the sweep finds a live
 * channel — that is one confirm call away — but *who it asks*. A visitor's page
 * load shares one feed read with every other visitor for `FEED_TTL`, and that
 * shared answer is the whole reason a wall watching fifty channels is
 * affordable at all. **Check now** is the opposite question: an operator
 * pressing it wants what is true this second, and a cached answer from before
 * the broadcast started is exactly the answer that leaves a live channel
 * reading "not seen on air yet" on the panel.
 *
 * So the assertions below are on the request options, because that is where the
 * difference lives — Next reads `cache` and `next.revalidate` off the init and
 * nothing observable downstream records which one it was.
 */

const CHANNEL = "UCabcdefghijklmnopqrstuv";
const VIDEO = "abcdefghijk";

const watched: Watched = {
  key: `youtube:${CHANNEL}`,
  provider: "youtube",
  id: CHANNEL,
  name: "Somebody",
  input: "@somebody",
  url: `https://www.youtube.com/channel/${CHANNEL}`,
  addedAt: 1,
};

const feed = `<feed><entry><yt:videoId>${VIDEO}</yt:videoId></entry></feed>`;

/** A `videos.list` answer for a broadcast that is on air right now. */
const onAir = {
  items: [
    {
      id: VIDEO,
      snippet: {
        title: "On now",
        channelId: CHANNEL,
        channelTitle: "Somebody",
        liveBroadcastContent: "live",
      },
      liveStreamingDetails: { actualStartTime: "2026-07-28T00:00:00Z", concurrentViewers: "7" },
    },
  ],
};

/** The same channel's newest video, which is a finished upload and not a broadcast. */
const offAir = {
  items: [
    {
      id: VIDEO,
      snippet: {
        title: "Yesterday's upload",
        channelId: CHANNEL,
        channelTitle: "Somebody",
        liveBroadcastContent: "none",
      },
    },
  ],
};

type Call = { url: string; init: RequestInit | undefined };

let calls: Call[] = [];

function stubFetch(confirm: unknown): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("feeds/videos.xml")) {
        return { ok: true, text: async () => feed } as unknown as Response;
      }
      return { ok: true, json: async () => confirm } as unknown as Response;
    }),
  );
}

/** The two legs, told apart by the host each one goes to. */
function leg(which: "feed" | "confirm"): RequestInit {
  const match = calls.find((call) =>
    which === "feed"
      ? call.url.includes("feeds/videos.xml")
      : call.url.includes("googleapis.com/youtube/v3/videos"),
  );
  if (!match) throw new Error(`the sweep never made its ${which} call`);
  return match.init ?? {};
}

/** What Next reads off an init to decide whether to serve the Data Cache. */
function caching(init: RequestInit): { cache?: string; revalidate?: number } {
  const { next } = init as { next?: { revalidate?: number } };
  return { cache: init.cache, revalidate: next?.revalidate };
}

beforeEach(() => {
  vi.stubEnv("YOUTUBE_API_KEY", "key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sweepWatchlist", () => {
  it("goes past the cache to both platforms when the sweep was asked for by hand", async () => {
    stubFetch(onAir);

    const sweep = await sweepWatchlist([watched], true);

    expect(caching(leg("feed"))).toEqual({ cache: "no-store", revalidate: undefined });
    expect(caching(leg("confirm"))).toEqual({ cache: "no-store", revalidate: undefined });
    expect(sweep.liveKeys).toEqual([`youtube:${CHANNEL}`]);
    expect(sweep.result.found).toBe(1);
  });

  it("shares one answer across visitors when the sweep is a page load", async () => {
    stubFetch(onAir);

    const sweep = await sweepWatchlist([watched]);

    expect(caching(leg("feed"))).toEqual({ cache: undefined, revalidate: FEED_TTL });
    expect(caching(leg("confirm"))).toEqual({ cache: undefined, revalidate: CONFIRM_TTL });
    expect(sweep.liveKeys).toEqual([`youtube:${CHANNEL}`]);
  });

  it("names no key for a channel that is not on air, however it was asked", async () => {
    stubFetch(offAir);

    const sweep = await sweepWatchlist([watched], true);

    expect(sweep.streams).toEqual([]);
    expect(sweep.liveKeys).toEqual([]);
    expect(sweep.result.found).toBe(0);
  });
});
