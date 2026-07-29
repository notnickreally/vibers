import { describe, expect, it } from "vitest";
import { mint, printMatches, requireSession, requireStage, type Token } from "./session";

/**
 * The staged sign-in's security model, in tests.
 *
 * The one that matters most is `requireSession` refusing a genuine, unexpired,
 * correctly-signed stage token. Both cookies are signed with the same key, so
 * anything that checked only the signature would accept a halfway-through-the-
 * door token as a full sign-in — and layers two and three would be scenery.
 */

const SECRET = "a".repeat(48);
const NOW = 1_700_000_000_000;

function token(over: Partial<Token> = {}): Token {
  return {
    kind: "session",
    admin: "admin-1",
    handle: "nick",
    stage: 3,
    print: "abcdefgh",
    expires: NOW + 60_000,
    ...over,
  };
}

describe("requireSession", () => {
  it("accepts a session token and returns what was signed", () => {
    const opened = requireSession(mint(token(), SECRET), SECRET, NOW);
    expect(opened?.handle).toBe("nick");
    expect(opened?.kind).toBe("session");
  });

  it("REFUSES a valid stage token — the stage-skip this whole design exists to stop", () => {
    for (const stage of [1, 2, 3, 99]) {
      const stageToken = mint(token({ kind: "stage", stage }), SECRET);
      // Genuinely signed, unexpired, and names a real admin. Still not a session.
      expect(requireStage(stageToken, SECRET, NOW, stage)).not.toBeNull();
      expect(requireSession(stageToken, SECRET, NOW)).toBeNull();
    }
  });

  it("refuses a token signed with a different key", () => {
    expect(requireSession(mint(token(), "b".repeat(48)), SECRET, NOW)).toBeNull();
  });

  it("refuses an expired token, exactly at the boundary", () => {
    const expiring = mint(token({ expires: NOW }), SECRET);
    expect(requireSession(expiring, SECRET, NOW - 1)).not.toBeNull();
    expect(requireSession(expiring, SECRET, NOW)).toBeNull();
    expect(requireSession(expiring, SECRET, NOW + 1)).toBeNull();
  });

  it("refuses a token whose payload was edited", () => {
    const raw = mint(token({ kind: "stage", stage: 1 }), SECRET);
    const [payload, signature] = raw.split(".");
    const edited = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    edited.kind = "session";
    edited.stage = 3;
    const forged = `${Buffer.from(JSON.stringify(edited), "utf8").toString("base64url")}.${signature}`;
    expect(requireSession(forged, SECRET, NOW)).toBeNull();
  });

  it("refuses rubbish without throwing", () => {
    for (const bad of [
      undefined,
      null,
      "",
      ".",
      "a.",
      ".b",
      "no-dot-at-all",
      "!!!.???",
      42,
      {},
      "a".repeat(2000),
      `${"a".repeat(1200)}.${"b".repeat(1200)}`,
    ]) {
      expect(requireSession(bad, SECRET, NOW)).toBeNull();
      expect(requireStage(bad, SECRET, NOW, 1)).toBeNull();
    }
  });

  it("refuses a signed payload that isn't a token at all", () => {
    for (const junk of ["null", '"string"', "[]", "17", '{"kind":"session"}']) {
      const payload = Buffer.from(junk, "utf8").toString("base64url");
      const raw = mint(token(), SECRET);
      // Re-sign the junk properly, so only the shape check can reject it.
      const signed = mint(token(), SECRET).split(".")[1];
      expect(requireSession(`${payload}.${signed}`, SECRET, NOW)).toBeNull();
      expect(raw).toContain(".");
    }
  });
});

describe("requireStage", () => {
  it("compares the stage exactly — never >=", () => {
    const stage1 = mint(token({ kind: "stage", stage: 1 }), SECRET);
    expect(requireStage(stage1, SECRET, NOW, 1)).not.toBeNull();
    // Layer three asks for stage 2. A stage-1 cookie must not answer it, or
    // the patch bay is optional.
    expect(requireStage(stage1, SECRET, NOW, 2)).toBeNull();

    const stage2 = mint(token({ kind: "stage", stage: 2 }), SECRET);
    expect(requireStage(stage2, SECRET, NOW, 2)).not.toBeNull();
    // And a further-along cookie must not walk backwards into layer two.
    expect(requireStage(stage2, SECRET, NOW, 1)).toBeNull();
  });

  it("refuses a session token where a stage token belongs", () => {
    const session = mint(token(), SECRET);
    expect(requireStage(session, SECRET, NOW, 1)).toBeNull();
    expect(requireStage(session, SECRET, NOW, 2)).toBeNull();
  });
});

describe("printMatches", () => {
  it("is how changing a credential signs the old cookies out", () => {
    const opened = requireSession(mint(token({ print: "before" }), SECRET), SECRET, NOW);
    expect(opened).not.toBeNull();
    if (!opened) return;
    expect(printMatches(opened, "before")).toBe(true);
    expect(printMatches(opened, "after")).toBe(false);
  });
});
