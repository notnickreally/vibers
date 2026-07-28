import { describe, expect, it } from "vitest";
import {
  DISCOVER_TTL,
  MAX_CANDIDATES,
  MAX_KEYWORDS,
  MAX_SOURCED,
  mergeSourced,
  readCandidates,
  readConfirmed,
  readReason,
  resolveKeywords,
  sanitizeKeyword,
  SEARCH_BUDGET,
  SEED_KEYWORDS,
  SOURCED_TTL_MS,
} from "./discover";
import type { Metadata, Stream } from "./stream";

/**
 * Auto-sourcing, minus the fetching.
 *
 * Everything the route decides lives in `discover.ts` precisely so it can be
 * pinned here — the suite runs in vitest's default node environment with no
 * mocks, so a decision made inline in a route handler is a decision nothing
 * checks. What matters most is the promise the feature makes: only streams
 * YouTube confirms are on air ever reach the wall.
 */

const ID = "dQw4w9WgXcQ";
const OTHER = "jfKfPfyJRdk";
const NOW = 1_700_000_000_000;
const CHANNEL = "UC_x5XG1OV2P6uZZ5FSM9Ttw";

/** A `videos.list` item for something genuinely on air. */
function liveItem(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    snippet: { liveBroadcastContent: "live", title: "Building a thing", channelTitle: "Someone" },
    liveStreamingDetails: { actualStartTime: "2026-07-28T09:00:00Z" },
    ...over,
  };
}

function stream(over: Partial<Stream> = {}): Stream {
  return {
    videoId: ID,
    title: "A stream",
    channel: "A channel",
    thumbnail: `https://i.ytimg.com/vi/${ID}/mqdefault.jpg`,
    addedAt: NOW,
    ...over,
  };
}

function meta(over: Partial<Metadata> = {}): Metadata {
  return {
    videoId: OTHER,
    title: "Found by keyword",
    channel: "Another channel",
    thumbnail: `https://i.ytimg.com/vi/${OTHER}/mqdefault.jpg`,
    isLive: true,
    ...over,
  };
}

describe("sanitizeKeyword", () => {
  it("keeps an ordinary keyword", () => {
    expect(sanitizeKeyword("vibecoding live")).toBe("vibecoding live");
  });

  it("folds case and collapses whitespace, so duplicates can be caught", () => {
    expect(sanitizeKeyword("  Using   Claude   Code ")).toBe("using claude code");
  });

  // The keyword is interpolated into a query we hand to Google, so the charset
  // is an allowlist and a keyword outside it fails whole rather than being
  // escaped into the URL — the same discipline `parseIds` applies to ids.
  it("rejects anything outside the allowlist rather than escaping it", () => {
    for (const bad of ["&key=stolen", "live/coding", "a?b", "<script>", "café"]) {
      expect(sanitizeKeyword(bad)).toBeNull();
    }
  });

  // A newline is whitespace, and whitespace is collapsed before the allowlist
  // runs — so a keyword wrapped across two lines of an env var becomes one
  // keyword rather than being thrown away. Safe by construction: every `\s`
  // becomes a plain space, and what is left still has to pass the allowlist.
  it("folds a line break into a space rather than rejecting the keyword", () => {
    expect(sanitizeKeyword("live\ncoding")).toBe("live coding");
    expect(sanitizeKeyword("live coding")).toBe("live coding");
  });

  it("rejects a keyword too short to mean anything or too long to be one", () => {
    expect(sanitizeKeyword("a")).toBeNull();
    expect(sanitizeKeyword("a".repeat(65))).toBeNull();
    expect(sanitizeKeyword("a".repeat(64))).toBe("a".repeat(64));
  });

  it("is total over junk", () => {
    for (const junk of [undefined, null, 42, {}, [], "", "   "]) {
      expect(sanitizeKeyword(junk)).toBeNull();
    }
  });
});

describe("resolveKeywords", () => {
  // The two the ticket named have to survive the sanitizer, which is the part
  // worth checking — asserting the constant contains them proves only that a
  // literal equals itself.
  it("carries the seed keywords through unchanged", () => {
    const keywords = resolveKeywords(undefined);
    expect(keywords).toContain("vibecoding live");
    expect(keywords).toContain("using claude code");
    expect(keywords).toEqual(SEED_KEYWORDS.map((k) => sanitizeKeyword(k)));
  });

  it("lets a deployment replace the list", () => {
    expect(resolveKeywords("rust live, pair programming")).toEqual([
      "rust live",
      "pair programming",
    ]);
  });

  it("drops the keywords it cannot sanitize instead of the whole list", () => {
    expect(resolveKeywords("good one, &key=stolen, another one")).toEqual([
      "good one",
      "another one",
    ]);
  });

  it("collapses duplicates however they were cased", () => {
    expect(resolveKeywords("live coding, LIVE CODING,  live   coding ")).toEqual(["live coding"]);
  });

  // Every keyword is a search a day, and the TTL is derived from this cap — so
  // an operator pasting twenty of them must not quietly buy twenty times the spend.
  it("caps the list at the number the quota budget was derived from", () => {
    const many = Array.from({ length: 40 }, (_, i) => `keyword ${i}`).join(",");
    expect(resolveKeywords(many)).toHaveLength(MAX_KEYWORDS);
  });

  it("falls back to the seeds on an empty or all-junk environment", () => {
    expect(resolveKeywords("")).toEqual(resolveKeywords(undefined));
    expect(resolveKeywords("   ")).toEqual(resolveKeywords(undefined));
    expect(resolveKeywords(",,,")).toEqual([]);
  });
});

describe("the search budget", () => {
  /**
   * The one arithmetic fact the whole feature rests on: `search.list` allows a
   * hundred calls a day per Google Cloud project, and this deployment spends at
   * most half. `DISCOVER_TTL` is derived from the cap rather than chosen beside
   * it, so the two cannot drift apart when someone adds a keyword.
   */
  it("cannot spend more than the budget at any keyword count", () => {
    for (let keywords = 1; keywords <= MAX_KEYWORDS; keywords++) {
      expect((keywords * 86_400) / DISCOVER_TTL).toBeLessThanOrEqual(SEARCH_BUDGET);
    }
  });

  it("leaves half of YouTube's hundred a day for the other environments", () => {
    expect(SEARCH_BUDGET).toBeLessThanOrEqual(50);
  });
});

describe("readCandidates", () => {
  it("reads video ids out of a search response", () => {
    expect(
      readCandidates({ items: [{ id: { videoId: ID } }, { id: { videoId: OTHER } }] }),
    ).toEqual([ID, OTHER]);
  });

  // These ids go straight into another URL handed to Google, so anything that
  // isn't recognisably an id is dropped rather than passed along.
  it("drops anything that isn't a video id", () => {
    expect(
      readCandidates({
        items: [{ id: { videoId: "&part=snippet" } }, { id: { videoId: ID } }, { id: {} }, {}],
      }),
    ).toEqual([ID]);
  });

  it("collapses an id two keywords both found", () => {
    expect(readCandidates({ items: [{ id: { videoId: ID } }, { id: { videoId: ID } }] })).toEqual([
      ID,
    ]);
  });

  it("caps at the number the confirmation leg is willing to ask about", () => {
    const items = Array.from({ length: 400 }, (_, i) => ({
      // Eleven characters each, or they would rightly be dropped.
      id: { videoId: `id${String(i).padStart(9, "0")}` },
    }));
    expect(readCandidates({ items })).toHaveLength(MAX_CANDIDATES);
  });

  it("is total over junk", () => {
    for (const junk of [undefined, null, {}, [], { items: null }, { items: 3 }, "nope"]) {
      expect(readCandidates(junk)).toEqual([]);
    }
  });
});

describe("readConfirmed", () => {
  it("keeps a stream the video resource says is on air", () => {
    const [found] = readConfirmed({ items: [liveItem()] });
    expect(found.videoId).toBe(ID);
    expect(found.isLive).toBe(true);
    expect(found.title).toBe("Building a thing");
  });

  /**
   * The feature's one hard promise. `eventType=live` is a search-index query
   * with no freshness guarantee, and the `liveBroadcastContent` that comes back
   * inside those results is self-confirming — it reads "live" because "live" is
   * what was asked for. So every one of these has to be filtered out here.
   */
  it("lets nothing that is not live through", () => {
    const notLive = [
      // Ran, and finished.
      liveItem({
        liveStreamingDetails: {
          actualStartTime: "2026-07-28T09:00:00Z",
          actualEndTime: "2026-07-28T11:00:00Z",
        },
      }),
      // Scheduled, not started — no actualStartTime.
      liveItem({
        snippet: { liveBroadcastContent: "upcoming", title: "Soon" },
        liveStreamingDetails: { scheduledStartTime: "2026-07-29T09:00:00Z" },
      }),
      // An ordinary upload: never a broadcast, so no liveStreamingDetails.
      liveItem({ snippet: { liveBroadcastContent: "none", title: "A video" } , liveStreamingDetails: undefined }),
      // The index still says live but the resource has no start time.
      liveItem({ liveStreamingDetails: {} }),
    ];
    for (const item of notLive) {
      expect(readConfirmed({ items: [item] })).toEqual([]);
    }
    expect(readConfirmed({ items: notLive })).toEqual([]);
  });

  /**
   * Ids that are deleted, private or never real come back absent rather than
   * null, so the response is shorter than the request. Matching by position
   * would hang one stream's title on another stream's id.
   */
  it("matches by id, never by position", () => {
    const found = readConfirmed({ items: [liveItem({ id: OTHER })] });
    expect(found).toHaveLength(1);
    expect(found[0].videoId).toBe(OTHER);
  });

  it("rebuilds the thumbnail from the id rather than trusting the response", () => {
    const [found] = readConfirmed({
      items: [liveItem({ snippet: { ...liveItem().snippet, thumbnails: { high: { url: "x" } } } })],
    });
    expect(found.thumbnail).toBe(`https://i.ytimg.com/vi/${ID}/mqdefault.jpg`);
  });

  it("links the channel only when the id is really a channel id", () => {
    const [linked] = readConfirmed({
      items: [liveItem({ snippet: { ...liveItem().snippet, channelId: CHANNEL } })],
    });
    expect(linked.channelUrl).toBe(`https://www.youtube.com/channel/${CHANNEL}`);

    const [unlinked] = readConfirmed({
      items: [liveItem({ snippet: { ...liveItem().snippet, channelId: "../../evil" } })],
    });
    expect(unlinked.channelUrl).toBeUndefined();
  });

  // A hidden or absent viewer count is not zero viewers, so it stays undefined
  // rather than being rendered as "0 watching".
  it("leaves an absent viewer count undefined", () => {
    expect(readConfirmed({ items: [liveItem()] })[0].viewers).toBeUndefined();
    const [counted] = readConfirmed({
      items: [
        liveItem({
          liveStreamingDetails: { actualStartTime: "2026-07-28T09:00:00Z", concurrentViewers: "42" },
        }),
      ],
    });
    expect(counted.viewers).toBe(42);
  });

  it("refuses a stream with no title", () => {
    expect(
      readConfirmed({ items: [liveItem({ snippet: { liveBroadcastContent: "live", title: "  " } })] }),
    ).toEqual([]);
  });

  it("is total over junk", () => {
    const junk = [
      undefined,
      null,
      {},
      { items: null },
      { items: [null] },
      { items: [{ id: ID }] },
      { items: [{ id: 7, snippet: 3, liveStreamingDetails: "x" }] },
      "nope",
    ];
    for (const input of junk) {
      expect(Array.isArray(readConfirmed(input))).toBe(true);
    }
  });
});

describe("readReason", () => {
  it("says nothing about a response that worked", () => {
    expect(readReason(200, {})).toBeNull();
  });

  // Quota and everything else are worth telling apart because only one of them
  // is hopeless until midnight Pacific.
  it("recognises a spent search allowance", () => {
    expect(
      readReason(403, { error: { errors: [{ reason: "quotaExceeded", message: "<a href=…>" }] } }),
    ).toBe("quota");
  });

  it("calls a bad key an upstream problem, not a quota one", () => {
    expect(readReason(400, { error: { errors: [{ reason: "badRequest" }] } })).toBe("upstream");
    expect(readReason(403, { error: { errors: [{ reason: "forbidden" }] } })).toBe("upstream");
  });

  it("is total over junk", () => {
    for (const junk of [undefined, null, {}, { error: null }, { error: { errors: 4 } }, "x"]) {
      expect(readReason(500, junk)).toBe("upstream");
    }
  });
});

describe("mergeSourced", () => {
  it("puts what it found on the wall", () => {
    const next = mergeSourced([], [meta()], [], NOW);
    expect(next).toHaveLength(1);
    expect(next[0].sourcedAt).toBe(NOW);
  });

  // The feature must never delete the wall to make room for streams nobody chose.
  it("never evicts a stream you added yourself", () => {
    const manual = Array.from({ length: 30 }, (_, i) =>
      stream({ videoId: `id${String(i).padStart(9, "0")}` }),
    );
    const found = Array.from({ length: 30 }, (_, i) =>
      meta({ videoId: `fd${String(i).padStart(9, "0")}` }),
    );
    const next = mergeSourced(manual, found, [], NOW);
    for (const own of manual) {
      expect(next.some((s) => s.videoId === own.videoId)).toBe(true);
    }
  });

  it("caps how much of the wall sourcing can take", () => {
    const found = Array.from({ length: 40 }, (_, i) =>
      meta({ videoId: `fd${String(i).padStart(9, "0")}` }),
    );
    const next = mergeSourced([], found, [], NOW);
    expect(next).toHaveLength(MAX_SOURCED);
  });

  // Sourced is what the sweep and the dismissal act on, so a stream you pasted
  // must not be quietly reclassified as one the site found.
  it("keeps a stream you pasted yourself when sourcing finds it too", () => {
    const next = mergeSourced([stream()], [meta({ videoId: ID })], [], NOW);
    expect(next).toHaveLength(1);
    expect(next[0].sourcedAt).toBeUndefined();
    expect(next[0].title).toBe("A stream");
  });

  /**
   * The one that matters most. The search behind a discovery is cached for
   * hours, so without this the next visit re-adds a stream you just removed —
   * and since removing one also clears its Notes transcript, the loop would
   * destroy your own writing once per visit.
   */
  it("never brings back a stream you threw off the wall", () => {
    expect(mergeSourced([], [meta()], [OTHER], NOW)).toEqual([]);
  });

  it("drops a sourced stream that was dismissed while it sat there", () => {
    const next = mergeSourced([stream({ sourcedAt: NOW })], [], [ID], NOW);
    expect(next).toEqual([]);
  });

  it("sweeps sourced streams once they are a day old, without being asked", () => {
    const old = stream({ sourcedAt: NOW });
    expect(mergeSourced([old], [], [], NOW + SOURCED_TTL_MS - 1)).toHaveLength(1);
    expect(mergeSourced([old], [], [], NOW + SOURCED_TTL_MS)).toEqual([]);
    // A stream you added yourself is not swept, however old it is.
    expect(mergeSourced([stream()], [], [], NOW + SOURCED_TTL_MS * 400)).toHaveLength(1);
  });

  it("collapses an id that came back twice in one run", () => {
    expect(mergeSourced([], [meta(), meta()], [], NOW)).toHaveLength(1);
  });

  it("is total over junk", () => {
    const junk = [undefined, null, {}, [], "nope", 7];
    for (const wall of junk) {
      for (const found of junk) {
        const next = mergeSourced(
          wall as unknown as Stream[],
          found as unknown as Metadata[],
          undefined as unknown as string[],
          NOW,
        );
        expect(Array.isArray(next)).toBe(true);
      }
    }
    // An entry with no videoId is not a stream, however it got into the store.
    expect(mergeSourced([{} as Stream, stream()], [], [], NOW)).toHaveLength(1);
  });

  // A clock that has gone backwards, or a hand-edited store, must not resurrect
  // or immortalise anything.
  it("survives a sourcedAt in the future", () => {
    const next = mergeSourced([stream({ sourcedAt: NOW + SOURCED_TTL_MS * 10 })], [], [], NOW);
    expect(Array.isArray(next)).toBe(true);
  });

  it("survives a clock that is NaN or nonsense", () => {
    const sourced = stream({ sourcedAt: NOW });
    for (const now of [Number.NaN, -1, 0, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY]) {
      expect(() => mergeSourced([sourced], [], [], now)).not.toThrow();
    }
  });

  // `sourcedAt` is the field the sweep, the cap and the dismissal all key off,
  // so a hand-edited one that isn't a number must fall on the safe side: it is
  // treated as a stream you added, which is the side nothing deletes.
  it("treats a non-numeric sourcedAt as a stream you added yourself", () => {
    const weird = { ...stream(), sourcedAt: "yesterday" } as unknown as Stream;
    expect(mergeSourced([weird], [], [], NOW + SOURCED_TTL_MS * 10)).toHaveLength(1);
  });
});
