/**
 * The signed tokens the admin gate hands out, and the rules for believing one.
 *
 * There are two kinds, and keeping them apart is the whole security model of a
 * staged sign-in. A **stage** token says "this browser got past layer one" (or
 * two). A **session** token says "this browser got past all three". Both are
 * signed with the same key, so a stage token is a perfectly valid signature —
 * which means anything that checks only the signature would accept a
 * halfway-through-the-door cookie as a full sign-in, and layers two and three
 * would be decoration.
 *
 * So `kind` is a field in the signed payload, and `requireSession` compares it
 * with `===` against `"session"`. There is a test that does nothing but hand
 * `requireSession` a genuine stage-2 token and insist on `null`.
 *
 * The stage number is compared exactly, too — `=== stage`, never `>=`. Layer
 * three refuses a stage-1 cookie for the same reason it refuses no cookie: the
 * point of the second layer is that you cannot skip it.
 *
 * Everything here is pure. It takes the secret and the current time as
 * arguments rather than reading the environment or the clock, which is what
 * lets the suite drive expiry and forgery without a server.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a half-finished sign-in stays open. Long enough to solve a puzzle. */
export const STAGE_TTL_MS = 5 * 60 * 1000;

/** How long a completed sign-in lasts. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Nothing legitimate is anywhere near this long; it stops a megabyte of "cookie". */
const MAX_TOKEN_LENGTH = 1024;

export type TokenKind = "stage" | "session";

export interface Token {
  /** Which door this opens. Never inferred — always compared. */
  kind: TokenKind;
  /** The admin's row id. */
  admin: string;
  /** Their handle, so the panel can greet them without another query. */
  handle: string;
  /** Layers passed. 1 or 2 for a stage token; 3 for a session. */
  stage: number;
  /** Truncated fingerprint of the stored credentials, from `secrets.fingerprint`. */
  print: string;
  /** Absolute expiry, in epoch milliseconds. */
  expires: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Mint a token. The caller sets the expiry, because the caller knows the clock. */
export function mint(token: Token, secret: string): string {
  const payload = Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify a token's signature and expiry, and nothing else.
 *
 * Deliberately not exported as the thing routes call — a caller that reaches
 * for "is this token valid?" without saying which kind it wants is the bug this
 * file exists to prevent. Use `requireStage` or `requireSession`.
 */
function open(raw: unknown, secret: string, now: number): Token | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_TOKEN_LENGTH) return null;

  const split = raw.indexOf(".");
  if (split <= 0 || split === raw.length - 1) return null;
  const payload = raw.slice(0, split);
  const provided = Buffer.from(raw.slice(split + 1), "base64url");
  const expected = Buffer.from(sign(payload, secret), "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let token: unknown;
  try {
    token = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof token !== "object" || token === null) return null;

  const { kind, admin, handle, stage, print, expires } = token as Record<string, unknown>;
  if (kind !== "stage" && kind !== "session") return null;
  if (typeof admin !== "string" || admin.length === 0) return null;
  if (typeof handle !== "string" || handle.length === 0) return null;
  if (typeof print !== "string" || print.length === 0) return null;
  if (typeof stage !== "number" || !Number.isInteger(stage)) return null;
  if (typeof expires !== "number" || !Number.isFinite(expires)) return null;
  if (now >= expires) return null;

  return { kind, admin, handle, stage, print, expires };
}

/**
 * A token that proves exactly `stage` layers were passed — no more, no fewer.
 *
 * The exact comparison is the point. `>=` would let a session token walk into
 * the middle of the sign-in flow, and a stage-1 token answer layer three.
 */
export function requireStage(raw: unknown, secret: string, now: number, stage: number): Token | null {
  const token = open(raw, secret, now);
  if (!token) return null;
  return token.kind === "stage" && token.stage === stage ? token : null;
}

/** A token that proves the whole gate was passed. A stage token is never one. */
export function requireSession(raw: unknown, secret: string, now: number): Token | null {
  const token = open(raw, secret, now);
  if (!token) return null;
  return token.kind === "session" ? token : null;
}

/**
 * Does this token still describe the credentials on file?
 *
 * Checked after the row is read, so changing a passphrase — which changes the
 * fingerprint — invalidates every cookie that was issued against the old one.
 */
export function printMatches(token: Token, print: string): boolean {
  return token.print === print;
}
