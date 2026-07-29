import { describe, expect, it } from "vitest";
import { decoyDigest, fingerprint, hash, MAX_SECRET_LENGTH, secretsMatch, verify } from "./secrets";

/**
 * scrypt is deliberately slow, so this suite hashes as few times as it can get
 * away with and reuses the digests. The generous timeouts are the cost of
 * testing the real parameters rather than a cheap stand-in — a suite that
 * verified against N=2 would not catch a `maxmem` mistake, which is exactly the
 * failure mode these parameters were chosen to avoid.
 */

describe("hash and verify", () => {
  it("round-trips, and refuses everything else", { timeout: 20_000 }, async () => {
    const stored = await hash("correct horse battery staple");
    expect(stored.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verify("correct horse battery staple", stored)).toBe(true);
    expect(await verify("Correct horse battery staple", stored)).toBe(false);
    expect(await verify("", stored)).toBe(false);
    expect(await verify("correct horse battery stapl", stored)).toBe(false);
  });

  it("salts, so the same secret twice is two different digests", { timeout: 20_000 }, async () => {
    const [a, b] = await Promise.all([hash("same secret here"), hash("same secret here")]);
    expect(a).not.toBe(b);
    expect(await verify("same secret here", a)).toBe(true);
    expect(await verify("same secret here", b)).toBe(true);
  });

  it("hashes the whole of a long secret", { timeout: 20_000 }, async () => {
    const long = "y".repeat(MAX_SECRET_LENGTH);
    const stored = await hash(long);
    expect(await verify(long, stored)).toBe(true);
    // Not truncated somewhere in the middle and compared on a prefix.
    expect(await verify(`${long.slice(0, -1)}z`, stored)).toBe(false);
  });

  it("returns false for a corrupt stored value rather than throwing", async () => {
    for (const bad of [
      "",
      "scrypt",
      "scrypt$16384$8$1$salt",
      "scrypt$16384$8$1$salt$digest$extra",
      "bcrypt$16384$8$1$c2FsdA$ZGlnZXN0",
      "scrypt$x$8$1$c2FsdA$ZGlnZXN0",
      "scrypt$16384$8$1$$ZGlnZXN0",
      "scrypt$16384$8$1$c2FsdA$",
      "$$$$$",
    ]) {
      expect(await verify("anything at all", bad)).toBe(false);
    }
  });

  it("refuses a stored row asking for more work than we ever produce", async () => {
    // A hostile row could otherwise turn one login into a gigabyte allocation.
    const stored = "scrypt$1048576$16$4$c2FsdHNhbHRzYWx0$ZGlnZXN0ZGlnZXN0ZGlnZXN0";
    expect(await verify("anything at all", stored)).toBe(false);
  });

  it("refuses a digest with a bit flipped", { timeout: 20_000 }, async () => {
    const stored = await hash("flip one bit of this");
    const parts = stored.split("$");
    const digest = Buffer.from(parts[5], "base64url");
    digest[0] ^= 0x01;
    parts[5] = digest.toString("base64url");
    expect(await verify("flip one bit of this", parts.join("$"))).toBe(false);
  });
});

describe("decoyDigest", () => {
  it("is stable, well-formed, and matches nothing", { timeout: 20_000 }, async () => {
    const first = await decoyDigest();
    expect(await decoyDigest()).toBe(first);
    expect(first.startsWith("scrypt$")).toBe(true);
    // The whole point: an unknown handle pays for a real verification that
    // cannot succeed, so response time says nothing about who has an account.
    expect(await verify("", first)).toBe(false);
    expect(await verify("guess", first)).toBe(false);
  });
});

describe("secretsMatch", () => {
  it("is true only for identical secrets", () => {
    expect(secretsMatch("deployment-password", "deployment-password")).toBe(true);
    expect(secretsMatch("deployment-password", "deployment-passwerd")).toBe(false);
  });

  it("handles different lengths without throwing", () => {
    // `timingSafeEqual` on raw buffers would throw here, and the 500 would
    // itself be the answer. Hashing both sides first is what avoids that.
    expect(secretsMatch("", "x")).toBe(false);
    expect(secretsMatch("short", "a".repeat(10_000))).toBe(false);
    expect(secretsMatch("", "")).toBe(true);
  });

  it("compares bytes, not characters", () => {
    expect(secretsMatch("é", "é")).toBe(true);
    expect(secretsMatch("é", "é")).toBe(false);
  });
});

describe("fingerprint", () => {
  it("moves when any credential moves", () => {
    const before = fingerprint("pass", "patch", "dial");
    expect(fingerprint("pass", "patch", "dial")).toBe(before);
    expect(fingerprint("PASS", "patch", "dial")).not.toBe(before);
    expect(fingerprint("pass", "patch2", "dial")).not.toBe(before);
    expect(fingerprint("pass", "patch", "dial2")).not.toBe(before);
  });

  it("cannot be confused by moving a boundary between parts", () => {
    // Joined with a separator rather than concatenated, so "ab"+"c" and
    // "a"+"bc" are not the same fingerprint.
    expect(fingerprint("ab", "c", "d")).not.toBe(fingerprint("a", "bc", "d"));
  });

  it("is short enough to sit in a cookie", () => {
    expect(fingerprint("a", "b", "c").length).toBeLessThanOrEqual(16);
  });
});
