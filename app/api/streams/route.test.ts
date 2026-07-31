import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The wall's door, from the outside.
 *
 * What is worth pinning here is not that `DELETE` removes a row — `lib/wall.ts`
 * owns that — but that it *refuses* to, and refuses **before** reaching the
 * store. A gate that returns 401 after the write is not a gate, and nothing in
 * the shape of the handler makes that mistake visible on a reading, so every
 * refusal below asserts the store was never touched.
 *
 * The two halves of the gate are mocked because neither is this route's: the
 * origin check is a header comparison `lib/admin/guard.ts` owns, and the session
 * check reads a cookie out of a request context that exists only inside Next.
 * Mocking them is what lets this file ask the question it is actually about —
 * given each answer, what does the route do — and `app/api/watchlist/route.ts`
 * has carried the same pair unmocked in production since it was written.
 */

// The route reaches `lib/lookup-source.ts` on the way in, which is
// `server-only` and throws outside a React Server Component. Stubbed rather
// than worked around, exactly as `lib/watch-live.test.ts` does it.
vi.mock("server-only", () => ({}));

const guard = vi.hoisted(() => ({
  sameOrigin: vi.fn<(request: Request) => boolean>(() => true),
  currentAdmin: vi.fn<(now: number) => Promise<{ handle: string } | null>>(async () => null),
}));

const wall = vi.hoisted(() => ({
  listStreams: vi.fn(async () => [{ videoId: "dQw4w9WgXcQ" }]),
  removeStream: vi.fn(async () => [{ videoId: "kept" }]),
  clearSourced: vi.fn(async () => [{ videoId: "kept" }]),
}));

vi.mock("@/lib/admin/guard", () => guard);
vi.mock("@/lib/wall", () => wall);

const { AdminUnconfigured } = await import("@/lib/admin/config");
const { DELETE, GET } = await import("@/app/api/streams/route");

const OPERATOR = { handle: "nick" };

/** A same-origin call, as the wall's own `fetch` makes it. */
function del(query: string): Request {
  return new Request(`https://vibers.tv/api/streams${query}`, {
    method: "DELETE",
    headers: { origin: "https://vibers.tv" },
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** Nothing was written, whatever the answer was. */
function untouched() {
  expect(wall.removeStream).not.toHaveBeenCalled();
  expect(wall.clearSourced).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  guard.sameOrigin.mockReturnValue(true);
  guard.currentAdmin.mockResolvedValue(null);
});

describe("DELETE /api/streams — with no session", () => {
  it("refuses to take a stream off, and takes nothing off", async () => {
    const response = await DELETE(del("?v=dQw4w9WgXcQ"));

    expect(response.status).toBe(401);
    expect(await body(response)).toEqual({
      error: "Only an operator can take a stream off the wall.",
    });
    untouched();
  });

  it("refuses the sourced sweep too — both paths, not just the single one", async () => {
    const response = await DELETE(del("?sourced=1"));

    expect(response.status).toBe(401);
    untouched();
  });

  it("refuses before the key is even parsed, so a bad key still reads as 401", async () => {
    // Otherwise the 400 would tell an anonymous caller which keys the wall
    // considers well-formed — an oracle the gate exists to close.
    const response = await DELETE(del("?v=not-a-stream"));

    expect(response.status).toBe(401);
    untouched();
  });
});

describe("DELETE /api/streams — cross-site", () => {
  it("is refused on the origin alone, without consulting the session", async () => {
    guard.sameOrigin.mockReturnValue(false);
    guard.currentAdmin.mockResolvedValue(OPERATOR);

    const response = await DELETE(del("?v=dQw4w9WgXcQ"));

    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({ error: "Refused: cross-site request." });
    expect(guard.currentAdmin).not.toHaveBeenCalled();
    untouched();
  });
});

describe("DELETE /api/streams — as an operator", () => {
  beforeEach(() => {
    guard.currentAdmin.mockResolvedValue(OPERATOR);
  });

  it("takes the stream off, keyed by the parse rather than the string that arrived", async () => {
    const response = await DELETE(
      del("?v=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ"),
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ streams: [{ videoId: "kept" }] });
    expect(wall.removeStream).toHaveBeenCalledWith("dQw4w9WgXcQ", expect.any(Number));
  });

  it("clears every sourced stream when asked", async () => {
    const response = await DELETE(del("?sourced=1"));

    expect(response.status).toBe(200);
    expect(wall.clearSourced).toHaveBeenCalledTimes(1);
    expect(wall.removeStream).not.toHaveBeenCalled();
  });

  it("still answers 400 to a key that is not one, and removes nothing", async () => {
    const response = await DELETE(del("?v=not-a-stream"));

    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({ error: "Pass a stream key as ?v=" });
    untouched();
  });
});

describe("DELETE /api/streams — a deployment that cannot decide who is an admin", () => {
  it("refuses the removal rather than guessing at it", async () => {
    guard.currentAdmin.mockRejectedValue(new AdminUnconfigured("ADMIN_SESSION_SECRET is not set."));

    const response = await DELETE(del("?v=dQw4w9WgXcQ"));

    // 503 and the real reason — not the database's sentence, which is what
    // `failed` would have said, and not a 401, which would send an operator to
    // a gate that cannot open.
    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({ error: "ADMIN_SESSION_SECRET is not set." });
    untouched();
  });
});

describe("the rest of the door stays open", () => {
  it("reads the wall with no session at all", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ streams: [{ videoId: "dQw4w9WgXcQ" }] });
    expect(guard.currentAdmin).not.toHaveBeenCalled();
  });
});
