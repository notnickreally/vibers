import { describe, expect, it } from "vitest";
import { MAX_SOURCED } from "./discover";
import { parseTwitchKey } from "./twitch";
import {
  MAX_TWITCH_CATEGORIES,
  MAX_TWITCH_FOUND,
  readGames,
  readLiveStreams,
  resolveCategories,
  sanitizeCategory,
  TWITCH_DISCOVER_TTL,
  TWITCH_PAGE,
  TWITCH_REQUESTS_PER_MINUTE,
  TWITCH_REQUESTS_PER_RUN,
  TWITCH_SEED_CATEGORIES,
} from "./twitch-discover";

/**
 * Twitch auto-sourcing, minus the fetching.
 *
 * Everything the run decides lives in `twitch-discover.ts` precisely so it can
 * be pinned here — the suite runs in vitest's default node environment with no
 * mocks, so a decision made inline in a fetching module is a decision nothing
 * checks. The promises that matter most: only channels Twitch says are on air
 * reach the wall, nothing mature does, and every login is validated before it
 * becomes a key.
 */

const LOGIN = "theprimeagen";
const OTHER = "teej_dv";

/** A `/helix/streams` row for a channel genuinely on air. */
function row(over: Record<string, unknown> = {}) {
  return {
    user_login: LOGIN,
    user_name: "ThePrimeagen",
    game_name: "Software and Game Development",
    title: "Refactoring the thing",
    type: "live",
    viewer_count: 4200,
    is_mature: false,
    thumbnail_url:
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_theprimeagen-{width}x{height}.jpg",
    ...over,
  };
}

describe("sanitizeCategory", () => {
  it("keeps a real Twitch category name", () => {
    expect(sanitizeCategory("Software and Game Development")).toBe("Software and Game Development");
  });

  /**
   * The one way this differs from `sanitizeKeyword`, and the reason it is not
   * that function with a flag. `/helix/games?name=` is a lookup of a name, not a
   * search — so lowercasing "Science & Technology" turns a category that
   * resolves into one that does not.
   */
  it("preserves case, because Twitch matches the name as it spells it", () => {
    expect(sanitizeCategory("Science & Technology")).toBe("Science & Technology");
    expect(sanitizeCategory("  Just   Chatting ")).toBe("Just Chatting");
  });

  // The name is interpolated into a query we hand to Twitch, so the charset is
  // an allowlist and a name outside it fails whole rather than being escaped in.
  it("rejects anything outside the allowlist rather than escaping it", () => {
    for (const bad of ["&first=100", "a?b", "<script>", "games#anchor", "a\\b", "%41"]) {
      expect(sanitizeCategory(bad)).toBeNull();
    }
  });

  it("rejects a name too short to mean anything or too long to be one", () => {
    expect(sanitizeCategory("a")).toBeNull();
    expect(sanitizeCategory("a".repeat(65))).toBeNull();
    expect(sanitizeCategory("a".repeat(64))).toBe("a".repeat(64));
  });

  it("is total over junk", () => {
    for (const junk of [undefined, null, 42, {}, [], "", "   "]) {
      expect(sanitizeCategory(junk)).toBeNull();
    }
  });
});

describe("resolveCategories", () => {
  // The seeds have to survive the sanitizer, which is the part worth checking —
  // and "Science & Technology" is exactly the name a lowercasing sanitizer or a
  // narrower charset would quietly drop.
  it("carries the seed categories through unchanged", () => {
    expect(resolveCategories(undefined)).toEqual(TWITCH_SEED_CATEGORIES);
    expect(resolveCategories(undefined)).toContain("Science & Technology");
  });

  it("lets a deployment replace the list", () => {
    expect(resolveCategories("Art, Music")).toEqual(["Art", "Music"]);
  });

  it("drops the names it cannot sanitize instead of the whole list", () => {
    expect(resolveCategories("Art, &first=100, Music")).toEqual(["Art", "Music"]);
  });

  /**
   * Collapsed case-insensitively but stored with its case: Twitch would answer
   * the same row for both spellings, and asking twice wastes one of only
   * `MAX_TWITCH_CATEGORIES` slots. The first spelling wins because it is the one
   * with a chance of matching.
   */
  it("collapses duplicates however they were cased, keeping the first spelling", () => {
    expect(resolveCategories("Art, art,  ART ")).toEqual(["Art"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Category ${i}`).join(",");
    expect(resolveCategories(many)).toHaveLength(MAX_TWITCH_CATEGORIES);
  });

  it("falls back to the seeds on an empty environment", () => {
    expect(resolveCategories("")).toEqual(resolveCategories(undefined));
    expect(resolveCategories("   ")).toEqual(resolveCategories(undefined));
    // An all-junk list is not an absent one: it resolves to nothing, which the
    // fetching half reports as `no-category` rather than silently seeding.
    expect(resolveCategories(",,,")).toEqual([]);
  });
});

describe("the Twitch request budget", () => {
  /**
   * The inversion from `DISCOVER_TTL`. YouTube's TTL is arithmetic because
   * `search.list` has a hundred-a-day cliff; Twitch's is chosen for freshness
   * because Helix refills every minute. This is the check that the choice stays
   * inside the bucket, so shortening the TTL has to face the numbers.
   */
  it("spends far less than its slice of Helix's per-minute bucket", () => {
    const runsPerMinute = 60 / TWITCH_DISCOVER_TTL;
    expect(runsPerMinute * TWITCH_REQUESTS_PER_RUN).toBeLessThanOrEqual(
      TWITCH_REQUESTS_PER_MINUTE,
    );
  });

  // Helix charges a point per request out of 800 a minute, so this leg's whole
  // claim has to be a rounding error against it.
  it("claims only a small slice of the 800 a minute Twitch allows", () => {
    expect(TWITCH_REQUESTS_PER_MINUTE).toBeLessThanOrEqual(80);
  });

  /**
   * The Twitch leg can return a hundred rows in viewer order while
   * `mergeSourced` caps the whole sourced run at `MAX_SOURCED`. Without a cap of
   * its own it would take every slot and the YouTube leg would never place a
   * tile.
   */
  it("leaves room on the wall for the other platform", () => {
    expect(MAX_TWITCH_FOUND).toBeGreaterThan(0);
    expect(MAX_TWITCH_FOUND).toBeLessThan(MAX_SOURCED);
  });

  // Rows get filtered for being mature or untitled, so asking for exactly the
  // cap would come back short of a full wall.
  it("asks for more rows than it intends to keep", () => {
    expect(TWITCH_PAGE).toBeGreaterThan(MAX_TWITCH_FOUND);
    // Twitch's own ceiling for `first`.
    expect(TWITCH_PAGE).toBeLessThanOrEqual(100);
  });
});

describe("readGames", () => {
  it("reads category ids and names out of a games response", () => {
    expect(readGames({ data: [{ id: "1469308723", name: "Software and Game Development" }] })).toEqual(
      [{ id: "1469308723", name: "Software and Game Development" }],
    );
  });

  // These ids go straight into another URL handed to Twitch, so anything that
  // isn't recognisably an id is dropped rather than passed along.
  it("drops anything that isn't a category id", () => {
    expect(
      readGames({
        data: [
          { id: "&first=100", name: "Sneaky" },
          { id: "509670", name: "Science & Technology" },
          { id: 509670, name: "A number, not a string" },
          { id: "" },
          {},
        ],
      }),
    ).toEqual([{ id: "509670", name: "Science & Technology" }]);
  });

  it("collapses a category Twitch listed twice", () => {
    expect(readGames({ data: [{ id: "42", name: "A" }, { id: "42", name: "A" }] })).toHaveLength(1);
  });

  // The name is only ever shown, so an absent one falls back to the id rather
  // than dropping a category that resolved perfectly well.
  it("falls back to the id when the name is missing", () => {
    expect(readGames({ data: [{ id: "42" }] })).toEqual([{ id: "42", name: "42" }]);
  });

  it("is total over junk", () => {
    for (const junk of [undefined, null, {}, [], { data: null }, { data: 3 }, "nope"]) {
      expect(readGames(junk)).toEqual([]);
    }
  });
});

describe("readLiveStreams", () => {
  it("keeps a channel Twitch says is on air", () => {
    const [found] = readLiveStreams({ data: [row()] });
    expect(found.videoId).toBe(`twitch:channel:${LOGIN}`);
    expect(found.title).toBe("Refactoring the thing");
    expect(found.channel).toBe("ThePrimeagen");
    expect(found.isLive).toBe(true);
    expect(found.viewers).toBe(4200);
    expect(found.channelUrl).toBe(`https://www.twitch.tv/${LOGIN}`);
  });

  /**
   * Every key on the wall has to round-trip through `parseTwitchKey`, because
   * that is the gate every consumer of a stored key goes through — a key this
   * builds that `parseTwitchKey` refuses is a tile that renders as an error.
   * This is also what stops the local `LOGIN` copy from drifting away from
   * `lib/twitch.ts`'s.
   */
  it("mints keys that parse back to the channel they name", () => {
    const [found] = readLiveStreams({ data: [row()] });
    expect(parseTwitchKey(found.videoId)).toEqual({ kind: "channel", id: LOGIN });
  });

  /**
   * The wall opens in monitors mode, so every tile autoplays on a page nobody
   * asked to have filled. That is the same reason the YouTube leg sends
   * `safeSearch: "strict"`, made here with the field Twitch gives us.
   */
  it("drops a mature stream", () => {
    expect(readLiveStreams({ data: [row({ is_mature: true })] })).toEqual([]);
    // Only a literal `true` is mature. A missing field is not a claim either way,
    // and refusing every row without one would empty the wall.
    expect(readLiveStreams({ data: [row({ is_mature: undefined })] })).toHaveLength(1);
  });

  // Asserting `isLive: true` on a row that did not say it is live is exactly the
  // invention this codebase refuses to make — even though `/streams` should only
  // ever return live rows.
  it("lets nothing through that Twitch did not call live", () => {
    for (const type of ["", "playlist", undefined, null, 1]) {
      expect(readLiveStreams({ data: [row({ type })] })).toEqual([]);
    }
  });

  it("refuses a stream with no title", () => {
    for (const title of ["", "   ", undefined, 42]) {
      expect(readLiveStreams({ data: [row({ title })] })).toEqual([]);
    }
  });

  // The login becomes an embed URL and a wall key, so a login that isn't one is
  // dropped rather than interpolated.
  it("drops a login that isn't one", () => {
    for (const user_login of ["../../evil", "has spaces", "a".repeat(26), "", undefined, 7]) {
      expect(readLiveStreams({ data: [row({ user_login })] })).toEqual([]);
    }
  });

  it("lowercases the login, because a key is keyed on the lowercase one", () => {
    const [found] = readLiveStreams({ data: [row({ user_login: "ThePrimeagen" })] });
    expect(found.videoId).toBe(`twitch:channel:${LOGIN}`);
  });

  /**
   * Trusting `thumbnail_url` would buy nothing and cost the one guarantee the
   * rebuilt URL gives: it is the channel's *current* frame and refreshes itself.
   * Same instinct as rebuilding YouTube's `mqdefault` from the video id.
   */
  it("rebuilds the thumbnail from the login rather than trusting the response", () => {
    const [found] = readLiveStreams({
      data: [row({ thumbnail_url: "https://evil.example/{width}x{height}.jpg" })],
    });
    expect(found.thumbnail).toBe(
      `https://static-cdn.jtvnw.net/previews-ttv/live_user_${LOGIN}-1280x720.jpg`,
    );
  });

  // A hidden or absent viewer count is not zero viewers, so it stays undefined
  // rather than being rendered as "0 watching".
  it("leaves a missing viewer count undefined", () => {
    for (const viewer_count of [undefined, null, "lots", -1, Number.NaN]) {
      expect(readLiveStreams({ data: [row({ viewer_count })] })[0].viewers).toBeUndefined();
    }
    expect(readLiveStreams({ data: [row({ viewer_count: 0 })] })[0].viewers).toBe(0);
  });

  it("carries the category as the description, the way the sweep does", () => {
    expect(readLiveStreams({ data: [row()] })[0].description).toBe(
      "Software and Game Development",
    );
    expect(readLiveStreams({ data: [row({ game_name: "  " })] })[0].description).toBeUndefined();
  });

  it("collapses a channel listed twice", () => {
    expect(readLiveStreams({ data: [row(), row()] })).toHaveLength(1);
  });

  /**
   * Twitch sends `/streams` in viewer order, so the cap is a "top N" only if
   * nothing reshuffles it on the way through.
   */
  it("caps at what the wall will hold, keeping Twitch's order", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row({ user_login: `viber${i}`, viewer_count: 1000 - i }),
    );
    const found = readLiveStreams(rows.length > 0 ? { data: rows } : {});
    expect(found).toHaveLength(MAX_TWITCH_FOUND);
    expect(found[0].videoId).toBe("twitch:channel:viber0");
    expect(found.map((s) => s.viewers)).toEqual([...found.map((s) => s.viewers)].sort((a, b) => (b ?? 0) - (a ?? 0)));
  });

  it("takes a cap of its own, so a caller can ask for fewer", () => {
    const rows = [row(), row({ user_login: OTHER })];
    expect(readLiveStreams({ data: rows }, 1)).toHaveLength(1);
    expect(readLiveStreams({ data: rows }, 0)).toEqual([]);
  });

  it("is total over junk", () => {
    const junk = [
      undefined,
      null,
      {},
      { data: null },
      { data: [null] },
      { data: [{ type: "live" }] },
      { data: [{ type: 7, title: 3, user_login: {} }] },
      "nope",
    ];
    for (const input of junk) {
      expect(Array.isArray(readLiveStreams(input))).toBe(true);
    }
  });
});
