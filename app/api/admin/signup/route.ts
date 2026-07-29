import { NextResponse } from "next/server";
import { body, failed } from "@/app/api/admin/failure";
import { MAX_ADMINS, signupPassword } from "@/lib/admin/config";
import { sameOrigin } from "@/lib/admin/guard";
import { canonicalDial, canonicalHandle, canonicalPatches, validPassphrase } from "@/lib/admin/locks";
import { hash, secretsMatch } from "@/lib/admin/secrets";
import * as store from "@/lib/admin/store";

/**
 * Signing up. Gated by a password the deployment holds, not by an invitation.
 *
 * `GET` answers only how many seats are left, so the page can say "closed"
 * before anyone fills a form in. It deliberately does not say whether the
 * signup password is set — that is on the panel, behind the gate.
 *
 * `POST` takes the deployment password and all three of the credentials the
 * gate will later ask for: a passphrase, a patch set, a dial combination. All
 * three are hashed here and the plaintext never leaves this function.
 *
 * Signing up does **not** sign you in. The three layers exist to be walked
 * through, and handing out a session at the end of a form would mean the only
 * person who never proves they know the combination is the person who chose it
 * — which is exactly the person a stolen signup password impersonates.
 */

export const revalidate = 0;

export async function GET() {
  try {
    // Reading the password only to confirm it is set; the value is discarded.
    signupPassword();
    return NextResponse.json({ open: true, seats: await store.seatsLeft(), max: MAX_ADMINS });
  } catch (err) {
    return failed(err);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Refused: cross-site request." }, { status: 403 });
  }

  let password: string;
  try {
    password = signupPassword();
  } catch (err) {
    return failed(err);
  }

  const input = await body(request);
  if (!input) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });

  const given = input.password;
  if (typeof given !== "string" || given.length === 0 || given.length > 512) {
    return NextResponse.json({ error: "Wrong signup password." }, { status: 401 });
  }
  // Constant-time, and hashed on both sides first so a length mismatch is not
  // its own answer. This is a real secret rather than a digest, so it needs the
  // same care as one.
  if (!secretsMatch(given, password)) {
    return NextResponse.json({ error: "Wrong signup password." }, { status: 401 });
  }

  const handle = canonicalHandle(input.handle);
  if (!handle) {
    return NextResponse.json(
      { error: "A handle is 3–32 characters: lowercase letters, digits, - and _." },
      { status: 400 },
    );
  }

  const passphrase = validPassphrase(input.passphrase);
  if (!passphrase) {
    return NextResponse.json(
      { error: "A passphrase is at least 10 characters. Longer is better than stranger." },
      { status: 400 },
    );
  }

  const patchbay = canonicalPatches(input.patches);
  if (!patchbay) {
    return NextResponse.json(
      { error: "Patch exactly three cables, no jack used twice." },
      { status: 400 },
    );
  }

  const dial = canonicalDial(input.dial);
  if (!dial) {
    return NextResponse.json({ error: "Lock in exactly three notches." }, { status: 400 });
  }

  try {
    // Hashed before the row is built, so `lib/admin/store.ts` never handles a
    // plaintext credential and cannot accidentally log one.
    const result = await store.create({
      handle,
      passphrase: await hash(passphrase),
      patchbay: await hash(patchbay),
      dial: await hash(dial),
      now: Date.now(),
    });

    if (!result.ok) {
      return result.reason === "taken"
        ? NextResponse.json({ error: "That handle is taken." }, { status: 409 })
        : NextResponse.json(
            { error: `This deployment is full at ${MAX_ADMINS} admins.` },
            { status: 409 },
          );
    }
    return NextResponse.json({ ok: true, handle });
  } catch (err) {
    return failed(err);
  }
}
