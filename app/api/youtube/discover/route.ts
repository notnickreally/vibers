import { NextResponse } from "next/server";
import { discover } from "@/lib/sourcing";

/**
 * Go and find live coding streams, by keyword.
 *
 * The work is `lib/sourcing`'s — the two-leg search/confirm design, the memo
 * and the quota latch are all documented there. They live there rather than
 * here because `app/api/streams/source` runs the same discovery against the
 * shared wall, and both callers must share the one memo: a scarce, unbuyable
 * daily budget cannot afford two copies of the thing that rations it.
 */

export const revalidate = 0;

export async function GET() {
  return NextResponse.json(await discover(Date.now()));
}
