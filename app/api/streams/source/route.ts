import { NextResponse } from "next/server";
import { failed } from "@/app/api/streams/failure";
import { discover } from "@/lib/sourcing";
import * as wall from "@/lib/wall";

/**
 * Go and find live streams, and fold what is found into the shared wall.
 *
 * The merge is `mergeSourced`'s, unchanged and still pure — a stream someone
 * added by hand is never evicted, a stream anyone threw off never comes back,
 * sourced entries are capped and swept after a day.
 *
 * What *has* changed is where the writing happens. On a per-browser wall two
 * tabs merging at once each clobbered the other's result and nobody could
 * tell; here the read, the merge and the write all happen in one place against
 * one row set, so the losing side of a race is a duplicate of the winner
 * rather than a lost update.
 *
 * A discovery that finds nothing — switched off, no key, quota spent, YouTube
 * unreachable — still answers 200 with its reason. The wall keeps what it has
 * and the panel says why, which is the whole reason `reason` exists.
 */

export const revalidate = 0;

export async function POST() {
  const result = await discover(Date.now());
  try {
    return NextResponse.json({
      streams: await wall.applySourced(result.streams, Date.now()),
      result,
    });
  } catch (err) {
    return failed(err);
  }
}
