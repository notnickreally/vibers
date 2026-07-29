/**
 * The authorization boundary. Every admin route asks this file, and only this
 * file, whether it may proceed.
 *
 * The pure decisions live in `lib/admin/session.ts` — signature, expiry, kind,
 * stage — and the suite drives them there without a server. What is here is the
 * part that needs a request: reading the cookie, loading the row, checking that
 * the credentials the token was minted against are still the credentials on
 * file, and checking where the request came from.
 *
 * The rule the rest of the app relies on: **no page vouches for a route.**
 * `/admin` redirecting an unauthorized visitor is a courtesy to the visitor,
 * not a security control — anyone can call `/api/admin/streams` directly, so
 * every one of those handlers calls `currentAdmin` for itself.
 */

import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { sessionSecret } from "./config";
import { fingerprint } from "./secrets";
import {
  mint,
  printMatches,
  requireSession,
  requireStage,
  SESSION_TTL_MS,
  STAGE_TTL_MS,
  type Token,
} from "./session";
import { type Admin, findById } from "./store";

/** Half-finished sign-ins. Short-lived, and cleared the moment one completes. */
export const STAGE_COOKIE = "vibers_admin_stage";

/** A completed sign-in. */
export const SESSION_COOKIE = "vibers_admin";

const production = process.env.NODE_ENV === "production";

/**
 * Cookie options, shared so the two cookies cannot drift apart.
 *
 * `httpOnly` because no script has any business reading these — an XSS on the
 * panel should not also be a credential theft. `sameSite: "lax"` because the
 * only navigation that should carry an admin cookie is one the operator
 * started; combined with the origin check below, that is this panel's CSRF
 * defence. `secure` off in development only, because localhost is not HTTPS
 * and a cookie that never arrives is not more secure, just broken.
 */
function options(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: production,
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

/** The fingerprint a token must still match. Changing any credential moves it. */
export function credentialPrint(admin: Admin): string {
  return fingerprint(admin.passphrase, admin.patchbay, admin.dial);
}

/** Put a stage token on the response — "you passed layer `stage`, carry on". */
export function grantStage(
  response: NextResponse,
  admin: Admin,
  stage: number,
  now: number,
): NextResponse {
  const token: Token = {
    kind: "stage",
    admin: admin.id,
    handle: admin.handle,
    stage,
    print: credentialPrint(admin),
    expires: now + STAGE_TTL_MS,
  };
  response.cookies.set(STAGE_COOKIE, mint(token, sessionSecret()), options(STAGE_TTL_MS));
  return response;
}

/** Put a session token on the response, and clear the stage token it replaces. */
export function grantSession(response: NextResponse, admin: Admin, now: number): NextResponse {
  const token: Token = {
    kind: "session",
    admin: admin.id,
    handle: admin.handle,
    stage: 3,
    print: credentialPrint(admin),
    expires: now + SESSION_TTL_MS,
  };
  response.cookies.set(SESSION_COOKIE, mint(token, sessionSecret()), options(SESSION_TTL_MS));
  response.cookies.set(STAGE_COOKIE, "", { ...options(0), maxAge: 0 });
  return response;
}

/** Sign out, or give up halfway. Both cookies go. */
export function revoke(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, "", { ...options(0), maxAge: 0 });
  response.cookies.set(STAGE_COOKIE, "", { ...options(0), maxAge: 0 });
  return response;
}

/**
 * Load the admin a token names, and re-check them against the database.
 *
 * A valid signature is not enough on its own: the row may have been deleted, or
 * its credentials changed since the token was minted. The fingerprint check is
 * the second of those — it is what makes changing a passphrase sign out every
 * other browser.
 */
async function resolve(token: Token | null): Promise<Admin | null> {
  if (!token) return null;
  const admin = await findById(token.admin);
  if (!admin) return null;
  return printMatches(token, credentialPrint(admin)) ? admin : null;
}

/** Who is signed in, if anyone. `null` covers every way of not being. */
export async function currentAdmin(now: number): Promise<Admin | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  return resolve(requireSession(raw, sessionSecret(), now));
}

/** Who is partway through, having passed exactly `stage` layers. */
export async function currentStage(stage: number, now: number): Promise<Admin | null> {
  const jar = await cookies();
  const raw = jar.get(STAGE_COOKIE)?.value;
  return resolve(requireStage(raw, sessionSecret(), now, stage));
}

/**
 * Did this request come from this site?
 *
 * `SameSite=Lax` already stops a cross-site form POST from carrying the cookie,
 * so this is the belt to that pair of braces — it costs one header comparison
 * and it closes the gap on any client that treats `Lax` loosely. A request with
 * no `Origin` at all is refused for mutations rather than waved through, since
 * every caller here is `fetch` from our own page and `fetch` always sends one.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
