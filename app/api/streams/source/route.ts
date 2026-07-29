import { NextResponse } from "next/server";
import { failed } from "@/app/api/streams/failure";
import { discover } from "@/lib/sourcing";
import { sourceWatched } from "@/lib/watch-run";

/**
 * Go and find live streams, and fold what is found into the shared wall.
 *
 * Three ways of finding them, and they answer different questions. YouTube
 * sourcing asks *what is live that matches "live coding"*; Twitch sourcing asks
 * *who is on air in this category*; the watchlist asks *are the people we named
 * on air*. All of them land through `mergeSourced` in one
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
 * A run that finds nothing — a platform switched off, no key, YouTube's daily
 * quota spent, a category Twitch does not recognise, either platform
 * unreachable, nobody watched — still answers 200, with a reason **per
 * platform**. The wall keeps what it has either way, and nothing on the page
 * narrates the reason any more; it is in the response so that an empty wall is
 * still explainable to whoever has to explain it.
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
