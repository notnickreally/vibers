import { describe, expect, it } from "vitest";
import {
  cardState,
  initialShelf,
  mergeStatuses,
  partition,
  shelf,
  type Status,
  type Stream,
} from "./stream";

/**
 * Only the pure half of the store is exercised here. `listStreams` and friends
 * reach for `window.localStorage` directly and short-circuit when there is no
 * `window`, so under vitest's default node environment they can only ever
 * report the SSR path — there is no seam to inject a `MemoryStorage` through,
 * the way `chat.ts` has one. What is worth pinning is the deciding, and all of
 * that is total functions over a `Stream`.
 */

function stream(over: Partial<Stream> = {}): Stream {
  return {
    videoId: "dQw4w9WgXcQ",
    title: "A stream",
    channel: "A channel",
    thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    addedAt: 1_700_000_000_000,
    ...over,
  };
}

const ENDED_AT = "2026-05-20T02:11:23Z";

describe("shelf", () => {
  it("puts a confirmed live stream on the live shelf", () => {
    expect(shelf(stream({ isLive: true }))).toBe("live");
  });

  it("puts a stream YouTube says is not live on the ended shelf", () => {
    expect(shelf(stream({ isLive: false }))).toBe("ended");
  });

  // Without YOUTUBE_API_KEY every stream reads undefined, so treating unknown
  // as "not live" would sweep an entire live wall into a tab labelled Ended.
  it("keeps an unconfirmed stream on the live shelf", () => {
    expect(shelf(stream())).toBe("live");
  });

  // ...but an end time is proof on its own, whatever isLive does or doesn't say.
  it("ends an unconfirmed stream that carries an end time", () => {
    expect(shelf(stream({ endedAt: ENDED_AT }))).toBe("ended");
  });

  it("prefers a live confirmation over a stale end time", () => {
    expect(shelf(stream({ isLive: true, endedAt: ENDED_AT }))).toBe("live");
  });

  // The wall is JSON.parsed out of localStorage without validation, so a
  // hand-edited entry reaches this function. It has to answer, not throw.
  it("is total over junk", () => {
    for (const junk of [undefined, null, {}, { isLive: "yes" }, []]) {
      expect(["live", "ended"]).toContain(shelf(junk as unknown as Stream));
    }
  });
});

describe("cardState", () => {
  it("calls a confirmed live stream live", () => {
    expect(cardState(stream({ isLive: true }))).toBe("live");
  });

  it("calls something that ran and finished ended", () => {
    expect(cardState(stream({ isLive: false, endedAt: ENDED_AT }))).toBe("ended");
  });

  // A music video is not an ended broadcast. YouTube only carries
  // liveStreamingDetails for something that was once live, so its absence is
  // the difference — and saying "ended" without it would be inventing a fact.
  it("calls a video that was never live a video, not ended", () => {
    expect(cardState(stream({ isLive: false }))).toBe("video");
  });

  it("says nothing about a stream it cannot confirm", () => {
    expect(cardState(stream())).toBe("unknown");
  });

  it("is total over junk", () => {
    for (const junk of [undefined, null, {}, []]) {
      expect(["live", "ended", "video", "unknown"]).toContain(
        cardState(junk as unknown as Stream),
      );
    }
  });
});

describe("partition", () => {
  it("splits the wall in two and keeps each side's order", () => {
    const a = stream({ videoId: "aaaaaaaaaaa", isLive: true });
    const b = stream({ videoId: "bbbbbbbbbbb", isLive: false });
    const c = stream({ videoId: "ccccccccccc", isLive: true });
    const { live, ended } = partition([a, b, c]);
    expect(live.map((s) => s.videoId)).toEqual(["aaaaaaaaaaa", "ccccccccccc"]);
    expect(ended.map((s) => s.videoId)).toEqual(["bbbbbbbbbbb"]);
  });

  it("loses nothing — every stream lands on exactly one shelf", () => {
    const wall = [
      stream({ videoId: "aaaaaaaaaaa", isLive: true }),
      stream({ videoId: "bbbbbbbbbbb", isLive: false }),
      stream({ videoId: "ccccccccccc" }),
      stream({ videoId: "ddddddddddd", endedAt: ENDED_AT }),
    ];
    const { live, ended } = partition(wall);
    expect(live.length + ended.length).toBe(wall.length);
  });

  it("handles an empty wall", () => {
    expect(partition([])).toEqual({ live: [], ended: [] });
  });
});

describe("initialShelf", () => {
  it("opens on live when anything is live", () => {
    expect(initialShelf([stream({ isLive: true }), stream({ isLive: false })])).toBe("live");
  });

  // Opening on an empty Live tab when the whole wall has finished is a blank
  // screen over a wall that has plenty on it.
  it("opens on ended when nothing is live", () => {
    expect(initialShelf([stream({ isLive: false })])).toBe("ended");
  });

  it("opens on live for an empty wall, so the empty state is the wall's own", () => {
    expect(initialShelf([])).toBe("live");
  });
});

describe("mergeStatuses", () => {
  const live: Status = { isLive: true, viewers: 2916 };

  it("folds a fresh status into the matching stream", () => {
    const [merged] = mergeStatuses([stream({ isLive: false })], { dQw4w9WgXcQ: live });
    expect(merged.isLive).toBe(true);
    expect(merged.viewers).toBe(2916);
  });

  it("moves a stream that has since ended, end time and all", () => {
    const [merged] = mergeStatuses([stream({ isLive: true, viewers: 12_400 })], {
      dQw4w9WgXcQ: { isLive: false, endedAt: ENDED_AT },
    });
    expect(shelf(merged)).toBe("ended");
    expect(merged.endedAt).toBe(ENDED_AT);
  });

  // concurrentViewers only exists while something is live, so carrying the
  // last one forward would leave a grey ended card reading "12.4K watching".
  it("clears the viewer count the moment a stream stops being live", () => {
    const [merged] = mergeStatuses([stream({ isLive: true, viewers: 12_400 })], {
      dQw4w9WgXcQ: { isLive: false },
    });
    expect(merged.viewers).toBeUndefined();
  });

  // A deleted or privated video comes back with no item at all. Reading that
  // absence as "not live" would file a stream we know nothing about as ended.
  it("leaves a stream the response said nothing about exactly as it was", () => {
    const before = stream({ isLive: true, viewers: 2916 });
    const [merged] = mergeStatuses([before], {});
    expect(merged).toEqual(before);
  });

  // The store is re-read at write time, but a response can still name a stream
  // taken off the wall since — and removeStream has already dropped its chat
  // transcript, so putting it back would resurrect half a stream.
  it("never adds a stream that is not already on the wall", () => {
    const merged = mergeStatuses([stream({ videoId: "aaaaaaaaaaa" })], {
      bbbbbbbbbbb: live,
    });
    expect(merged.map((s) => s.videoId)).toEqual(["aaaaaaaaaaa"]);
  });

  it("keeps the wall's length and order", () => {
    const wall = [
      stream({ videoId: "aaaaaaaaaaa" }),
      stream({ videoId: "bbbbbbbbbbb" }),
      stream({ videoId: "ccccccccccc" }),
    ];
    const merged = mergeStatuses(wall, { bbbbbbbbbbb: live });
    expect(merged.map((s) => s.videoId)).toEqual([
      "aaaaaaaaaaa",
      "bbbbbbbbbbb",
      "ccccccccccc",
    ]);
  });

  it("survives an empty wall and an empty response", () => {
    expect(mergeStatuses([], {})).toEqual([]);
  });
});
