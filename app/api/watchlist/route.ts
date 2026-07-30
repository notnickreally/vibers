import { NextResponse } from "next/server";
import { AdminUnconfigured } from "@/lib/admin/config";
import { currentAdmin, sameOrigin } from "@/lib/admin/guard";
import { DatabaseUnconfigured } from "@/lib/db";
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
 * The watched channels — one door, and one rule per method.
 *
 * This used to be `/api/admin/watchlist`, behind the gate in every direction.
 * It is public now, because naming a channel is the same kind of act as putting
 * a stream on the wall: the wall is everybody's, and so is the list of people it
 * keeps an eye on. What is *not* everybody's is taking something off a shared
 * list, so the asymmetry lives here rather than in two routes:
 *
 * - `GET` — who is watched. Open.
 * - `POST { input, provider }` — watch a channel. **Open.** The body carries a
 *   username or a profile link and, at most, which platform a selector was on;
 *   the name, the channel id and the link are established *here*, by asking the
 *   platform. Same rule the wall's own `POST` follows, and it matters more now
 *   that anyone can reach this: a display name accepted from a caller is
 *   arbitrary text on everyone's screen.
 * - `PUT` — sweep the watchlist now and fold whatever is on air onto the wall.
 *   Open, because it is the same sweep every visitor's page load already runs
 *   through `/api/streams/source`.
 * - `DELETE ?key=` — stop watching. **Admin only**, checked here on every call.
 *   A page that hides the button proves nothing to a route `curl` can reach.
 *
 * `sameOrigin` still guards all three mutations. It is not an authorization
 * check and never was — it is what stops another site's page from driving this
 * one on a visitor's behalf.
 */

export const revalidate = 0;

/** The one refusal `DELETE` gives. Never says whether the cookie was close. */
function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Only an operator can stop watching a channel." },
    { status: 401 },
  );
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Refused: cross-site request." }, { status: 403 });
}

/**
 * What this route says when it cannot do its job.
 *
 * Neither of the two existing helpers fits: `app/api/streams/failure.ts` speaks
 * for the wall and `app/api/admin/failure.ts` speaks for the panel, and this is
 * now a public route with one gated method. The `AdminUnconfigured` branch is
 * only reachable through `DELETE` — a deployment that cannot decide who is an
 * admin refuses the removal rather than guessing at it, while adds keep working.
 */
function failed(err: unknown): NextResponse {
  if (err instanceof AdminUnconfigured) {
    console.error("[channels] not configured");
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
  if (err instanceof DatabaseUnconfigured) {
    console.error("[channels] no database");
    return NextResponse.json(
      { error: "The channel list's database isn't configured here. DATABASE_URL is missing." },
      { status: 503 },
    );
  }
  console.error("[channels]", err instanceof Error ? err.message : "unknown error");
  return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
}

/**
 * Whose add this is, when it is anybody's.
 *
 * Attribution, not authorization: a signed-in operator's handle is worth
 * recording next to a row everybody can see, and an anonymous add is a row with
 * nobody's name on it rather than a refusal. Every way of not being signed in —
 * including a deployment with no admin configuration at all — is the same
 * `undefined` here, which is why this swallows rather than propagates.
 */
async function addedBy(now: number): Promise<string | undefined> {
  try {
    return (await currentAdmin(now))?.handle;
  } catch {
    return undefined;
  }
}

export async function GET() {
  try {
    return NextResponse.json({ watchlist: await listWatched() });
  } catch (err) {
    return failed(err);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return forbidden();

  let parsed: Record<string, unknown> | null;
  try {
    const json: unknown = await request.json();
    parsed = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : null;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

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

  // Established against the platform, never taken from the request. An add that
  // cannot name the channel fails here rather than storing the typed string as
  // though it were the channel's name.
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

  try {
    const now = Date.now();
    const result = await watch({
      target: resolved.target,
      name: resolved.name,
      input,
      url: resolved.url,
      addedBy: await addedBy(now),
      now,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: `The watchlist is full at ${MAX_WATCHED}. An operator has to remove one.` },
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
 * comes back unconfirmed — so pressing **Check now** on a stream you can plainly
 * see would keep telling you the channel has never been seen on air. See
 * `lib/watch-live.ts` for what `fresh` costs: one feed fetch per watched YouTube
 * channel (keyless and free), one `videos.list` per fifty candidates out of ten
 * thousand units a day, and one Helix call for every watched Twitch login at
 * once. That is the price of the button being honest, and it is why the sweep is
 * bounded by `MAX_WATCHED` rather than by who pressed it.
 */
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  try {
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

/**
 * Stop watching — the one thing on this route that takes a session.
 *
 * Adding is additive and reversible by whoever holds the panel; removing is
 * neither, and it happens to everybody at once. What is already on the wall
 * stays there either way — see `lib/watchlist.ts`.
 */
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
