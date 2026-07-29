import { describe, expect, it } from "vitest";
import {
  canonicalDial,
  canonicalHandle,
  canonicalPatches,
  DIAL_LENGTH,
  MAX_PASSPHRASE,
  MIN_PASSPHRASE,
  NOTCHES,
  PATCH_COUNT,
  validPassphrase,
} from "./locks";

/**
 * These are the functions standing between a request body and a digest, so the
 * cases that matter most here are the hostile ones. Every rejection is a `null`
 * rather than a throw — a route handler that 500s on a malformed patch set is a
 * route handler telling an attacker they found an edge.
 */

describe("canonicalPatches", () => {
  const patch = [
    { source: 4, destination: 1 },
    { source: 0, destination: 5 },
    { source: 2, destination: 3 },
  ];

  it("is order-independent — that is the whole promise of layer two", () => {
    const forwards = canonicalPatches(patch);
    const backwards = canonicalPatches([...patch].reverse());
    const shuffled = canonicalPatches([patch[1], patch[2], patch[0]]);
    expect(forwards).not.toBeNull();
    expect(backwards).toBe(forwards);
    expect(shuffled).toBe(forwards);
  });

  it("gives different sets different strings", () => {
    const other = canonicalPatches([
      { source: 4, destination: 1 },
      { source: 0, destination: 5 },
      { source: 2, destination: 0 },
    ]);
    expect(other).not.toBe(canonicalPatches(patch));
  });

  it("wants exactly three cables", () => {
    expect(canonicalPatches([])).toBeNull();
    expect(canonicalPatches(patch.slice(0, 2))).toBeNull();
    expect(canonicalPatches([...patch, { source: 1, destination: 2 }])).toBeNull();
    expect(PATCH_COUNT).toBe(3);
  });

  it("refuses a jack used twice, at either end", () => {
    expect(
      canonicalPatches([
        { source: 0, destination: 1 },
        { source: 0, destination: 2 },
        { source: 3, destination: 4 },
      ]),
    ).toBeNull();
    expect(
      canonicalPatches([
        { source: 0, destination: 1 },
        { source: 2, destination: 1 },
        { source: 3, destination: 4 },
      ]),
    ).toBeNull();
  });

  it("refuses indices off the ends of the bay", () => {
    for (const bad of [-1, 6, 6.5, Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      expect(canonicalPatches([{ source: bad, destination: 1 }, patch[1], patch[2]])).toBeNull();
      expect(canonicalPatches([{ source: 1, destination: bad }, patch[1], patch[2]])).toBeNull();
    }
  });

  it("refuses anything that isn't three patch objects", () => {
    for (const bad of [null, undefined, "patch:0>1", 3, {}, [1, 2, 3], [null, null, null]]) {
      expect(canonicalPatches(bad)).toBeNull();
    }
  });

  it("refuses a very large array without walking all of it", () => {
    expect(canonicalPatches(new Array(100_000).fill({ source: 0, destination: 0 }))).toBeNull();
  });

  it("ignores extra properties rather than letting them into the digest", () => {
    const withJunk = patch.map((p) => ({ ...p, admin: true, __proto__: { evil: 1 } }));
    expect(canonicalPatches(withJunk)).toBe(canonicalPatches(patch));
  });
});

describe("canonicalDial", () => {
  it("is order-dependent — a combination you can enter backwards is a worse lock", () => {
    expect(canonicalDial([1, 2, 3])).not.toBe(canonicalDial([3, 2, 1]));
  });

  it("allows a repeated notch, because a real lock does", () => {
    expect(canonicalDial([7, 7, 7])).toBe("dial:7-7-7");
  });

  it("wants exactly three notches, each on the face", () => {
    expect(canonicalDial([1, 2])).toBeNull();
    expect(canonicalDial([1, 2, 3, 4])).toBeNull();
    expect(canonicalDial([0, 0, NOTCHES])).toBeNull();
    expect(canonicalDial([0, 0, -1])).toBeNull();
    expect(canonicalDial([0, 0, 1.5])).toBeNull();
    expect(DIAL_LENGTH).toBe(3);
  });

  it("covers the whole face at both ends", () => {
    expect(canonicalDial([0, NOTCHES - 1, 0])).toBe(`dial:0-${NOTCHES - 1}-0`);
  });

  it("refuses anything that isn't three numbers", () => {
    for (const bad of [null, "0-1-2", ["0", "1", "2"], [[0], 1, 2], {}]) {
      expect(canonicalDial(bad)).toBeNull();
    }
  });
});

describe("canonicalHandle", () => {
  it("lowercases and trims, so one operator cannot be two rows", () => {
    expect(canonicalHandle("  Nick  ")).toBe("nick");
    expect(canonicalHandle("NICK")).toBe(canonicalHandle("nick"));
  });

  it("takes letters, digits, dash and underscore", () => {
    expect(canonicalHandle("gallery_op-2")).toBe("gallery_op-2");
  });

  it("refuses lengths outside 3–32 and anything else in the alphabet", () => {
    expect(canonicalHandle("ab")).toBeNull();
    expect(canonicalHandle("a".repeat(33))).toBeNull();
    expect(canonicalHandle("has space")).toBeNull();
    expect(canonicalHandle("semi;colon")).toBeNull();
    expect(canonicalHandle("' OR 1=1 --")).toBeNull();
    expect(canonicalHandle("<script>x</script>")).toBeNull();
    expect(canonicalHandle("naïve")).toBeNull();
    expect(canonicalHandle(42)).toBeNull();
    expect(canonicalHandle(null)).toBeNull();
  });

  it("accepts the exact boundaries", () => {
    expect(canonicalHandle("abc")).toBe("abc");
    expect(canonicalHandle("a".repeat(32))).toBe("a".repeat(32));
  });
});

describe("validPassphrase", () => {
  it("holds both ends of the range exactly", () => {
    expect(validPassphrase("x".repeat(MIN_PASSPHRASE - 1))).toBeNull();
    expect(validPassphrase("x".repeat(MIN_PASSPHRASE))).toHaveLength(MIN_PASSPHRASE);
    expect(validPassphrase("x".repeat(MAX_PASSPHRASE))).toHaveLength(MAX_PASSPHRASE);
    expect(validPassphrase("x".repeat(MAX_PASSPHRASE + 1))).toBeNull();
  });

  it("refuses an empty string and anything that isn't one", () => {
    expect(validPassphrase("")).toBeNull();
    expect(validPassphrase(null)).toBeNull();
    expect(validPassphrase(12345678901)).toBeNull();
  });
});
