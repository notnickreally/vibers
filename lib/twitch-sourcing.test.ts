import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `lib/twitch-sourcing.ts` is `server-only`, which throws outside a React Server
// Component. The suite is a third caller and wants the same function, so the
// marker is stubbed rather than the module being split in half to avoid it —
// the same arrangement `watch-live.test.ts` makes.
vi.mock("server-only", () => ({}));

import { TWITCH_PAGE } from "./twitch-discover";

/**
 * The Twitch sourcing run, and what it actually asks Twitch.
 *
 * The interesting thing here is not that a live channel comes back — that is
 * `readLiveStreams`' job and `twitch-discover.test.ts` pins it — but the
 * *sequence*: which endpoints get called, with what, how many times, and which
 * of the several ways to find nothing each failure is reported as. None of that
 * lives in a pure function, so this file stubs `fetch` and reads the calls back.
 *
 * Every reason on `TwitchReason` is reachable from here, which is the point: the
 * panel promises a visitor an explanation for an empty wall, and an explanation
 * nothing exercises is an explanation that can quietly become wrong.
 *
 * The module is re-imported per test. It keeps a memo and a category-id cache at
 * module scope — deliberately, because they are the only thing standing between
 * a page load and a request — so a fresh copy is the only honest way to run more
 * than one scenario against it.
 */

const GAME = "1469308723";

/** A `/helix/streams` answer with one channel on air. */
const onAir = {
  data: [
    {
      user_login: "somebody",
      user_name: "Somebody",
      game_name: "Software and Game Development",
      title: "On now",
      type: "live",
      viewer_count: 12,
      is_mature: false,
    },
  ],
};

type Call = { url: string; init: RequestInit | undefined };

let calls: Call[] = [];

/**
 * Answer the token mint, the category lookup and the stream fetch.
 *
 * `games` and `streams` are given separately so a test can fail one leg and
 * leave the other working — which is how the two `upstream` paths and the
 * `no-category` path are told apart at all.
 */
function stubFetch({
  games = { data: [{ id: GAME, name: "Software and Game Development" }] } as unknown,
  streams = onAir as unknown,
  gamesOk = true,
  streamsOk = true,
}: {
  games?: unknown;
  streams?: unknown;
  gamesOk?: boolean;
  streamsOk?: boolean;
} = {}): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const at = String(url);
      calls.push({ url: at, init });
      if (at.includes("id.twitch.tv/oauth2/token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "token", expires_in: 3600 }),
        } as unknown as Response;
      }
      if (at.includes("/helix/games")) {
        return { ok: gamesOk, status: gamesOk ? 200 : 500, json: async () => games } as unknown as Response;
      }
      return {
        ok: streamsOk,
        status: streamsOk ? 200 : 500,
        json: async () => streams,
      } as unknown as Response;
    }),
  );
}

/** The calls that went to one Helix endpoint. The token mint is never one. */
function helixCalls(path: "games" | "streams"): string[] {
  return calls.filter((call) => call.url.includes(`/helix/${path}`)).map((call) => call.url);
}

/** A fresh copy of the module, memo and category cache empty. */
async function fresh() {
  vi.resetModules();
  return (await import("./twitch-sourcing")).discoverTwitch;
}

beforeEach(() => {
  vi.stubEnv("TWITCH_DISCOVER_ENABLED", "1");
  vi.stubEnv("TWITCH_CLIENT_ID", "id");
  vi.stubEnv("TWITCH_CLIENT_SECRET", "secret");
  vi.stubEnv("TWITCH_DISCOVER_CATEGORIES", "Software and Game Development");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("discoverTwitch", () => {
  it("asks for the configured categories, then the streams in them", async () => {
    stubFetch();
    const discoverTwitch = await fresh();
    const run = await discoverTwitch(1_000);

    expect(helixCalls("games")).toHaveLength(1);
    expect(helixCalls("games")[0]).toContain("name=Software+and+Game+Development");

    const [streams] = helixCalls("streams");
    expect(streams).toContain(`game_id=${GAME}`);
    // A bigger page than the cap, on purpose: mature and untitled rows are
    // dropped after they arrive, so asking for exactly the cap would come up
    // short whenever one of them is in it.
    expect(streams).toContain(`first=${TWITCH_PAGE}`);

    expect(run.streams).toHaveLength(1);
    expect(run.streams[0].videoId).toBe("twitch:channel:somebody");
    expect(run.streams[0].isLive).toBe(true);
    expect(run.leg).toEqual({ asked: ["Software and Game Development"], found: 1 });
  });

  /**
   * The whole reason the leg addresses categories by name rather than by a magic
   * numeric id: a name Twitch does not recognise is a fixable typo in the
   * deployment's configuration, and it must not read as an outage or as nobody
   * streaming. Note that it never gets as far as `/streams` — there is nothing
   * to ask about.
   */
  it("says so when Twitch has never heard of the categories", async () => {
    stubFetch({ games: { data: [] } });
    const run = await (await fresh())(1_000);
    expect(run.leg.reason).toBe("no-category");
    expect(run.streams).toEqual([]);
    expect(helixCalls("streams")).toHaveLength(0);
  });

  it("says so when every configured category name is unusable", async () => {
    vi.stubEnv("TWITCH_DISCOVER_CATEGORIES", "&first=100, ?, %41");
    stubFetch();
    const run = await (await fresh())(1_000);
    expect(run.leg.reason).toBe("no-category");
    // Not one request: there was never a name worth asking about.
    expect(calls).toEqual([]);
  });

  // Two different failures, and both have to leave the wall alone rather than
  // asserting that nobody is streaming.
  it("reports an unreachable Twitch as upstream, on either leg", async () => {
    stubFetch({ gamesOk: false });
    expect((await (await fresh())(1_000)).leg.reason).toBe("upstream");

    stubFetch({ streamsOk: false });
    const run = await (await fresh())(1_000);
    expect(run.leg.reason).toBe("upstream");
    expect(run.streams).toEqual([]);
  });

  it("finds nothing, with no reason at all, when nobody is on air", async () => {
    stubFetch({ streams: { data: [] } });
    const run = await (await fresh())(1_000);
    // No reason: this is a working run whose answer is "nobody", and a reason
    // here would have the panel explain a failure that did not happen.
    expect(run.leg).toEqual({ asked: ["Software and Game Development"], found: 0 });
  });

  /**
   * `helix()` sends `cache: "no-store"` on every request, so Next's Data Cache is
   * not underneath this module — the memo is the only thing there is. Without it
   * every visitor's page load would spend a request, which is the difference
   * between one a run and one a viewer.
   */
  it("serves a second run inside the TTL from the memo, spending nothing", async () => {
    stubFetch();
    const discoverTwitch = await fresh();
    await discoverTwitch(1_000);
    const spent = calls.length;

    const again = await discoverTwitch(2_000);
    expect(calls).toHaveLength(spent);
    expect(again.streams).toHaveLength(1);
  });

  // A failure must not be repeated back for two minutes: the next visit is
  // entitled to a fresh attempt, because the thing that failed may have been a
  // blip.
  it("does not memoise a failed run", async () => {
    stubFetch({ streamsOk: false });
    const discoverTwitch = await fresh();
    await discoverTwitch(1_000);
    const spent = helixCalls("streams").length;

    await discoverTwitch(2_000);
    expect(helixCalls("streams").length).toBeGreaterThan(spent);
  });

  /* --- The two ways the leg is simply not running. --------------------- */

  it("is off unless the deployment turns it on, and asks nothing", async () => {
    vi.stubEnv("TWITCH_DISCOVER_ENABLED", "");
    stubFetch();
    const run = await (await fresh())(1_000);
    expect(run.leg.reason).toBe("off");
    expect(calls).toEqual([]);
  });

  /**
   * Twitch has no keyless read path at all — unlike the watchlist's YouTube half,
   * which at least has a free feed to fall back on. So with no credentials there
   * is no degraded answer to give, and the leg says which two values are missing
   * rather than reporting an empty wall.
   */
  it("needs credentials, and says so rather than guessing", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "");
    stubFetch();
    const run = await (await fresh())(1_000);
    expect(run.leg.reason).toBe("no-credentials");
    expect(calls).toEqual([]);
  });
});
