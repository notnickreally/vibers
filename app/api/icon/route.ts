import { NextResponse } from "next/server";
import { DEFAULT_ICON_PATH, decodeIcon, iconTag, tagMatches } from "@/lib/icon";
import { iconVersion, readIcon } from "@/lib/site-icon";

/**
 * The favicon, for everybody. The only URL the site's `<link rel="icon">` names.
 *
 * Three decisions live here, and each one is the answer to a way this could
 * have gone wrong:
 *
 * **The URL never changes; the `ETag` does.** The obvious way to bust a favicon
 * cache is to put a version in the URL — but the URL is written into the root
 * layout, so reading the version to render it would mean a database round trip
 * on every page of the site and would cost the wall its static render for the
 * sake of a 2 KB image. A fixed URL with `max-age=60` and the icon's own
 * `updated_at` as its tag gets the same result from the other end: a visitor
 * who has never been here gets the current icon immediately, and one who has
 * asks again within the minute and is told 304 — one `BIGINT` read, no image.
 *
 * **Nothing uploaded means the shipped default**, served by redirecting to the
 * static `public/icon.png` rather than by this route holding a copy of those
 * bytes. There is then exactly one default icon in the repo, and it is a file
 * you can look at.
 *
 * **A database that isn't there is not a site without a favicon.** Every other
 * route here fails loudly when Neon is missing, which is right — a wall that
 * silently shows nothing is a lie. A tab icon is not that: falling back to the
 * default is the honest answer, and it keeps a misconfigured deployment from
 * having a broken image in every tab.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Sixty seconds of quiet, then one conditional request. */
const CACHE = "public, max-age=60, must-revalidate";

function theDefault(request: Request): NextResponse {
  const response = NextResponse.redirect(new URL(DEFAULT_ICON_PATH, request.url), 307);
  response.headers.set("cache-control", CACHE);
  response.headers.set("etag", iconTag(null));
  return response;
}

export async function GET(request: Request) {
  let version: number | null;
  try {
    version = await iconVersion();
  } catch (err) {
    // Unset `DATABASE_URL`, or Neon unreachable. Logged, and then the tab gets
    // the icon this repo ships with instead of a broken image.
    console.error("[icon]", err instanceof Error ? err.message : "unknown error");
    return theDefault(request);
  }

  if (version === null) return theDefault(request);

  const tag = iconTag(version);
  if (tagMatches(request.headers.get("if-none-match"), tag)) {
    return new NextResponse(null, {
      status: 304,
      headers: { etag: tag, "cache-control": CACHE },
    });
  }

  const icon = await readIcon();
  // Cleared between the two reads. Rare, and the default is the right answer.
  if (!icon) return theDefault(request);

  const bytes = decodeIcon(icon.data);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type": icon.contentType,
      "content-length": String(bytes.byteLength),
      etag: tag,
      "cache-control": CACHE,
    },
  });
}
