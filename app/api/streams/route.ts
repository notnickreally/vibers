import { NextResponse } from "next/server";
import { failed } from "@/app/api/streams/failure";
import { AdminUnconfigured } from "@/lib/admin/config";
import { currentAdmin, sameOrigin } from "@/lib/admin/guard";
import { LookupError } from "@/lib/lookup";
import { lookupSource } from "@/lib/lookup-source";
import { parseKey, parseSource, PROVIDER_LABEL, sourceKey } from "@/lib/source";
import * as wall from "@/lib/wall";

/**
 * The wall itself — one shared wall, in Neon, for everybody.
 *
 * One door, and one rule per method — the same asymmetry `app/api/watchlist`
 * already spells out for the channels it watches, and for the same reason: the
 * wall is everybody's, so filling it is everybody's; emptying it is not.
 *
 * - `GET` — what is on it. Open.
 * - `POST { v }` — put a stream up. **Open**, and a key or a URL and nothing
 *   else. The title, channel and thumbnail are looked up here rather than
 *   accepted from the caller: this list is rendered to every visitor, so a
 *   client-supplied title would be arbitrary text and a client-supplied
 *   thumbnail an arbitrary `img src`, on everyone's wall, from anyone who can
 *   reach this route.
 * - `DELETE ?v=<key>` — take one off. `DELETE ?sourced=1` — take every
 *   auto-sourced one off. **Admin only**, checked here on every call, both
 *   paths. Adding a stream is additive and undoable; a removal happens to
 *   everybody at once and there is no undo — the row is gone, and a sourced one
 *   is remembered as dismissed so the sweep cannot put it back. The wall hides
 *   the ✕ from a visitor, but a page that hides a button proves nothing to a
 *   route `curl` can reach, which is why the check lives here.
 *
 * Both platforms come through the same door. What lands in the database is
 * `lib/source.ts`' key — a bare video id for YouTube, a prefixed one for Twitch
 * — and which platform it was is never a parameter the caller gets to set.
 *
 * Every response is the whole wall, so a client never has to reconstruct it
 * from a delta it may have raced someone else on.
 */

export const revalidate = 0;

/** The one refusal `DELETE` gives. Never says whether the cookie was close. */
function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Only an operator can take a stream off the wall." },
    { status: 401 },
  );
}

/**
 * Not an authorization check, and never was — it is what stops another site's
 * page from driving this one on a signed-in operator's behalf.
 */
function forbidden(): NextResponse {
  return NextResponse.json({ error: "Refused: cross-site request." }, { status: 403 });
}

export async function GET() {
  try {
    return NextResponse.json({ streams: await wall.listStreams() });
  } catch (err) {
    return failed(err);
  }
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = (await request.json()) as unknown;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const raw = (input as { v?: unknown })?.v;
  // A stored key as well as a pasted link: the watch page's "Add to wall"
  // button holds the key it was opened with, not the URL someone typed.
  const source = typeof raw === "string" ? (parseKey(raw) ?? parseSource(raw)) : null;
  if (!source) {
    return NextResponse.json({ error: "That isn't a YouTube or Twitch link." }, { status: 400 });
  }

  let meta: Awaited<ReturnType<typeof lookupSource>>;
  try {
    meta = await lookupSource(source);
  } catch (err) {
    const fail = err instanceof LookupError ? err : null;
    return NextResponse.json(
      {
        error:
          fail?.message ??
          `Couldn't reach ${PROVIDER_LABEL[source.provider]}. Check the connection and try again.`,
      },
      { status: fail?.status ?? 502 },
    );
  }

  try {
    // No `sourcedAt`: a stream someone chose is a manual one, and manual is
    // what keeps it out of the sweep's reach.
    return NextResponse.json({ streams: await wall.addStream(meta, Date.now()), added: meta });
  } catch (err) {
    return failed(err);
  }
}

/**
 * Take one off, or take every sourced one off. The one thing here that takes a
 * session — and the gate is the whole handler's, not one branch's.
 *
 * `sameOrigin` first, then the session, and both before the key is even parsed:
 * a caller with no business here learns nothing about whether the key was good.
 * A deployment that cannot decide who is an admin refuses the removal rather
 * than guessing at it, while adds keep working — the same stance
 * `app/api/watchlist` takes, and the reason that branch is spelled out here
 * instead of left to `failed`, which speaks for the database.
 */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return forbidden();

  const params = new URL(request.url).searchParams;
  try {
    if (!(await currentAdmin(Date.now()))) return unauthorized();

    if (params.get("sourced")) {
      return NextResponse.json({ streams: await wall.clearSourced(Date.now()) });
    }
    const raw = params.get("v") ?? "";
    const source = parseKey(raw) ?? parseSource(raw);
    if (!source) {
      return NextResponse.json({ error: "Pass a stream key as ?v=" }, { status: 400 });
    }
    // Taking one off is keyed by what the row is keyed by, so the key is
    // rebuilt from the parse rather than trusting the string that arrived.
    return NextResponse.json({ streams: await wall.removeStream(sourceKey(source), Date.now()) });
  } catch (err) {
    if (err instanceof AdminUnconfigured) {
      console.error("[wall] not configured");
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return failed(err);
  }
}
