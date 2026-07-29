import { NextResponse } from "next/server";
import { body, failed, REFUSED } from "@/app/api/admin/failure";
import { sessionSecret } from "@/lib/admin/config";
import { currentStage, grantSession, grantStage, sameOrigin } from "@/lib/admin/guard";
import { canonicalDial, canonicalHandle, canonicalPatches, validPassphrase } from "@/lib/admin/locks";
import { decoyDigest, verify } from "@/lib/admin/secrets";
import { type Admin, findByHandle, lockedUntil, noteFailure, noteSuccess } from "@/lib/admin/store";

/**
 * The gate. Three layers, one at a time, all of them decided here.
 *
 * The browser draws a clapperboard, a patch bay and a vectorscope, and none of
 * those drawings know anything. The expected patch set and the expected dial
 * combination are never sent to the client — they exist as scrypt digests in
 * one database column each, and the only thing that crosses the wire is the
 * operator's answer and a yes or a no.
 *
 * Progress between layers rides a signed, HttpOnly stage cookie. Layer two will
 * not look at a request whose cookie does not say "passed exactly one layer",
 * and layer three will not look at one that does not say two. So the fun layers
 * cannot be skipped by calling this route directly with the right JSON, which
 * is the first thing anyone will try.
 *
 * Two orderings in here are load-bearing:
 *
 * **The lockout is read before anything is hashed.** A locked-out handle costs
 * one indexed `SELECT` and nothing else. Checking it after the key derivation
 * would let anyone spend our CPU at will, on an account that cannot be opened
 * anyway.
 *
 * **An unknown handle still pays for a scrypt.** Against a decoy digest built
 * at module load, which can never match. Returning early on a handle that does
 * not exist would make the response time a membership oracle: ask twice, time
 * both, learn who has an account here.
 */

export const revalidate = 0;

/** Every refusal looks identical from outside, whichever layer it came from. */
function refuse(): NextResponse {
  return NextResponse.json({ error: REFUSED }, { status: 401 });
}

function lockedOut(until: number, now: number): NextResponse {
  const seconds = Math.max(1, Math.ceil((until - now) / 1000));
  return NextResponse.json(
    { error: `Too many wrong answers. Try again in ${seconds}s.`, retryAfter: seconds },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}

/**
 * The shared shape of layers two and three: the cookie must say the previous
 * layer was passed, the account must not be locked, and only then is anything
 * hashed. Returns the admin to check against, or the response to send instead.
 */
async function reach(
  stage: number,
  now: number,
): Promise<{ admin: Admin } | { response: NextResponse }> {
  const admin = await currentStage(stage, now);
  // No cookie, a forged one, an expired one, a session cookie where a stage
  // cookie belongs, or the right cookie for the wrong layer — all the same
  // answer, because they are all the same mistake.
  if (!admin) return { response: refuse() };
  const until = lockedUntil(admin, now);
  if (until) return { response: lockedOut(until, now) };
  return { admin };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Refused: cross-site request." }, { status: 403 });
  }

  try {
    // Asked for up front, and the value thrown away. Without it no cookie can
    // be signed, so every path below ends in a 503 anyway — this just makes it
    // say which variable is missing instead of reporting whichever dependency
    // happened to fail first, and does it before spending a key derivation.
    sessionSecret();
  } catch (err) {
    return failed(err);
  }

  const input = await body(request);
  if (!input) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });

  const now = Date.now();

  try {
    if (input.layer === 1) return await slate(input, now);
    if (input.layer === 2) return await patchBay(input, now);
    if (input.layer === 3) return await vectorscope(input, now);
    return NextResponse.json({ error: "Expected layer 1, 2 or 3." }, { status: 400 });
  } catch (err) {
    return failed(err);
  }
}

/** Layer one — the slate. Handle and passphrase. */
async function slate(input: Record<string, unknown>, now: number): Promise<NextResponse> {
  const handle = canonicalHandle(input.handle);
  const passphrase = validPassphrase(input.passphrase);
  // A handle that could not exist and a passphrase that could not be one are
  // rejected without a lookup. Neither leaks membership: no account has a
  // handle of this shape, so the answer is the same for everybody.
  if (!handle || !passphrase) return refuse();

  const admin = await findByHandle(handle);

  if (admin) {
    const until = lockedUntil(admin, now);
    if (until) return lockedOut(until, now);
  }

  const stored = admin?.passphrase ?? (await decoyDigest());
  const ok = await verify(passphrase, stored);

  if (!admin || !ok) {
    if (admin) {
      const until = await noteFailure(admin.id, now);
      if (until) return lockedOut(until, now);
    }
    return refuse();
  }

  return grantStage(NextResponse.json({ ok: true, stage: 1 }), admin, 1, now);
}

/** Layer two — the patch bay. A set of three cables, order-independent. */
async function patchBay(input: Record<string, unknown>, now: number): Promise<NextResponse> {
  const reached = await reach(1, now);
  if ("response" in reached) return reached.response;
  const { admin } = reached;

  const patches = canonicalPatches(input.patches);
  if (!patches) {
    await noteFailure(admin.id, now);
    return refuse();
  }

  if (!(await verify(patches, admin.patchbay))) {
    const until = await noteFailure(admin.id, now);
    return until ? lockedOut(until, now) : refuse();
  }

  return grantStage(NextResponse.json({ ok: true, stage: 2 }), admin, 2, now);
}

/** Layer three — the vectorscope. Three notches, in order. Then you are in. */
async function vectorscope(input: Record<string, unknown>, now: number): Promise<NextResponse> {
  const reached = await reach(2, now);
  if ("response" in reached) return reached.response;
  const { admin } = reached;

  const dial = canonicalDial(input.dial);
  if (!dial) {
    await noteFailure(admin.id, now);
    return refuse();
  }

  if (!(await verify(dial, admin.dial))) {
    const until = await noteFailure(admin.id, now);
    return until ? lockedOut(until, now) : refuse();
  }

  // Only a completed sign-in clears the counter. Getting one layer right is not
  // evidence of anything on its own.
  await noteSuccess(admin.id, now);
  return grantSession(NextResponse.json({ ok: true, stage: 3, handle: admin.handle }), admin, now);
}
