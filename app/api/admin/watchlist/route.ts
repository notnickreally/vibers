import { NextResponse } from "next/server";
import { body, failed } from "@/app/api/admin/failure";
import { currentAdmin, sameOrigin } from "@/lib/admin/guard";
import { LookupError } from "@/lib/lookup";
import {
  MAX_WATCHED,
  parseWatchInput,
  parseWatchKey,
  watchKey,
  type WatchProvider,
} from "@/lib/watch";
import { resolveWatch } from "@/lib/watch-resolve";
import { sourceWatched } from "@/lib/watch-run";
import { listWatched, unwatch, watch } from "@/lib/watchlist";

/**
 * The watchlist, managed.
 *
 * - `GET` — who is watched.
 * - `POST { input, provider }` — watch a channel. The body carries a username or
 *   a profile link and, at most, which platform the panel's selector was on;
 *   **the name, the channel id and the link are established here**, by asking
 *   the platform. Same rule the wall's own `POST` follows: a display name
 *   accepted from a caller is arbitrary text on everyone's screen.
 * - `PUT` — sweep the watchlist now and fold whatever is on air onto the wall.
 *   Exactly what every visitor's page load already does; this is the button that
 *   lets an operator watch it happen instead of waiting.
 * - `DELETE ?key=` — stop watching. What is already on the wall stays there —
 *   see `lib/watchlist.ts`.
 *
 * Every handler calls `currentAdmin` for itself. `/admin` redirecting an
 * unauthorized visitor is a courtesy to the visitor and not a control — `curl`
 * never sees a page.
 */

export const revalidate = 0;

/** The one refusal these routes give. Never says whether the cookie was close. */
function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Not signed in." }, { status: 401 });
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Refused: cross-site request." }, { status: 403 });
}

export async function GET() {
  try {
    if (!(await currentAdmin(Date.now()))) return unauthorized();
    return NextResponse.json({ watchlist: await listWatched() });
  } catch (err) {
    return failed(err);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  try {
    const admin = await currentAdmin(Date.now());
    if (!admin) return unauthorized();

    const parsed = await body(request);
    const input = typeof parsed?.input === "string" ? parsed.input.trim() : "";
    const raw = parsed?.provider;
    const provider: WatchProvider | undefined =
      raw === "youtube" || raw === "twitch" ? raw : undefined;

    const lookup = parseWatchInput(input, provider);
    if (!lookup) {
      return NextResponse.json(
        {
          error:
            "That isn't a YouTube or Twitch channel. Paste a profile link, or a username with the platform picked.",
        },
        { status: 400 },
      );
    }

    // Established against the platform, never taken from the request. An add
    // that cannot name the channel fails here rather than storing the typed
    // string as though it were the channel's name.
    let resolved: Awaited<ReturnType<typeof resolveWatch>>;
    try {
      resolved = await resolveWatch(lookup);
    } catch (err) {
      const fail = err instanceof LookupError ? err : null;
      return NextResponse.json(
        { error: fail?.message ?? "Couldn't reach the platform. Try again in a moment." },
        { status: fail?.status ?? 502 },
      );
    }

    const result = await watch({
      target: resolved.target,
      name: resolved.name,
      input,
      url: resolved.url,
      addedBy: admin.handle,
      now: Date.now(),
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: `The watchlist is full at ${MAX_WATCHED}. Remove one to add another.` },
        { status: 409 },
      );
    }

    return NextResponse.json({ watchlist: await listWatched(), added: result.watched });
  } catch (err) {
    return failed(err);
  }
}

/**
 * Check every watched channel right now, and put the live ones up.
 *
 * **Right now** is load-bearing, which is why this is the one caller that asks
 * for a fresh sweep. The same sequence on a page load reads YouTube through a
 * two-minute shared cache, and a channel that went on air inside that window
 * comes back unconfirmed — so an operator pressing **Check now** on a stream
 * they can plainly see would keep being told the channel has never been seen on
 * air. See `lib/watch-live.ts` for what `fresh` costs.
 */
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  try {
    if (!(await currentAdmin(Date.now()))) return unauthorized();
    const run = await sourceWatched([], Date.now(), true);
    return NextResponse.json({
      streams: run.streams,
      watchlist: await listWatched(),
      result: run.watchlist,
    });
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  try {
    if (!(await currentAdmin(Date.now()))) return unauthorized();

    const raw = new URL(request.url).searchParams.get("key") ?? "";
    // Rebuilt from the parse rather than trusting the string that arrived —
    // the same discipline the wall's own `DELETE` follows.
    const target = parseWatchKey(raw);
    if (!target) {
      return NextResponse.json({ error: "Pass a watchlist key as ?key=" }, { status: 400 });
    }
    await unwatch(watchKey(target));
    return NextResponse.json({ watchlist: await listWatched() });
  } catch (err) {
    return failed(err);
  }
}
