import { NextResponse } from "next/server";
import { failed } from "@/app/api/admin/failure";
import { environmentReadout } from "@/lib/admin/config";
import { currentAdmin, sameOrigin } from "@/lib/admin/guard";
import { roster } from "@/lib/admin/store";
import { parseKey, parseSource, sourceKey } from "@/lib/source";
import { fetchStatuses } from "@/lib/statuses";
import * as wall from "@/lib/wall";

/**
 * What an admin can do to the wall.
 *
 * The actions themselves are not new — `app/api/streams` has done all three
 * since the wall moved into Neon, and anyone can call them. What is new is that
 * these ones are attributed: the README's standing gap is that the wall is
 * shared but anonymous, so a removal is a thing that happened rather than a
 * thing somebody did. This route is the first surface where a removal has a
 * name behind it.
 *
 * Every handler calls `currentAdmin` for itself. `app/admin/page.tsx` redirects
 * an unauthorized visitor, but that redirect is a courtesy to the visitor and
 * not a control — `curl` never sees a page. A route that trusted the page that
 * called it would be a route with no authorization at all.
 */

export const revalidate = 0;

/** The one refusal these routes give. Never says whether the cookie was close. */
function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Not signed in." }, { status: 401 });
}

export async function GET() {
  try {
    const admin = await currentAdmin(Date.now());
    if (!admin) return unauthorized();
    return NextResponse.json({
      handle: admin.handle,
      streams: await wall.listStreams(),
      dismissed: (await wall.listDismissed()).length,
      // Booleans and a sentence each. The values are read on the server to
      // produce `set`, and never travel — a panel that printed an API key to
      // help you debug it would be the leak it was meant to prevent.
      environment: environmentReadout(),
      admins: await roster(),
    });
  } catch (err) {
    return failed(err);
  }
}

/** Re-ask both platforms what is still on air, and write the answer back. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Refused: cross-site request." }, { status: 403 });
  }
  try {
    if (!(await currentAdmin(Date.now()))) return unauthorized();
    const keys = (await wall.listStreams()).map((s) => s.videoId);
    return NextResponse.json({ streams: await wall.applyStatuses(await fetchStatuses(keys)) });
  } catch (err) {
    return failed(err);
  }
}

/** Take one stream off for everyone, or every auto-sourced one at once. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Refused: cross-site request." }, { status: 403 });
  }
  try {
    if (!(await currentAdmin(Date.now()))) return unauthorized();

    const params = new URL(request.url).searchParams;
    if (params.get("sourced")) {
      return NextResponse.json({ streams: await wall.clearSourced(Date.now()) });
    }

    const raw = params.get("v") ?? "";
    const source = parseKey(raw) ?? parseSource(raw);
    if (!source) {
      return NextResponse.json({ error: "Pass a stream key as ?v=" }, { status: 400 });
    }
    // Keyed by what the row is keyed by — rebuilt from the parse rather than
    // trusting the string that arrived, exactly as the public route does.
    return NextResponse.json({ streams: await wall.removeStream(sourceKey(source), Date.now()) });
  } catch (err) {
    return failed(err);
  }
}
