import { NextResponse } from "next/server";
import { fetchStatuses } from "@/lib/statuses";
import { parseIds } from "@/lib/youtube";

/**
 * Is it still on air? — for a batch of ids at once.
 *
 * `/api/youtube` resolves one video completely, including the oEmbed leg that
 * makes the app work with no key at all. This route answers the one question
 * that goes stale: a stream's title and channel are the same tomorrow, but
 * whether it is live right now is only true for as long as it is true.
 *
 * The fetching itself is `lib/statuses`', shared with the wall's own refresh
 * so there is exactly one spelling of "is it live".
 */

export const revalidate = 0;

export async function GET(request: Request) {
  // `parseIds` is the security boundary: these ids are interpolated into a URL
  // we hand to Google, so anything that isn't recognisably a video id is
  // dropped rather than escaped, duplicates collapse, and the count is capped.
  const ids = parseIds(new URL(request.url).searchParams.get("ids"));
  return NextResponse.json({ statuses: await fetchStatuses(ids) });
}
