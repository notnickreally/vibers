import { NextResponse } from "next/server";
import { failed } from "@/app/api/streams/failure";
import { discover } from "@/lib/sourcing";
import { sourceWatched } from "@/lib/watch-run";

/**
 * Go and find live streams, and fold what is found into the shared wall.
 *
 * Two ways of finding them, and they answer different questions. Keyword
 * sourcing asks *what is live that matches "live coding"*; the watchlist asks
 * *are the people we named on air*. Both land through `mergeSourced` in one
 * write — see `lib/watch-run.ts` for why the order of the two lists matters —
 * so a stream someone added by hand is never evicted, a stream anyone threw off
 * never comes back, and sourced entries are capped and swept after a day.
 *
 * What *has* changed is where the writing happens. On a per-browser wall two
 * tabs merging at once each clobbered the other's result and nobody could
 * tell; here the read, the merge and the write all happen in one place against
 * one row set, so the losing side of a race is a duplicate of the winner
 * rather than a lost update.
 *
 * A run that finds nothing — switched off, no key, quota spent, YouTube
 * unreachable, nobody watched — still answers 200 with its reason. The wall
 * keeps what it has and the panel says why, which is the whole reason `reason`
 * exists.
 */

export const revalidate = 0;

export async function POST() {
  const now = Date.now();
  const result = await discover(now);
  try {
    const run = await sourceWatched(result.streams, now);
    return NextResponse.json({ streams: run.streams, result, watchlist: run.watchlist });
  } catch (err) {
    return failed(err);
  }
}
