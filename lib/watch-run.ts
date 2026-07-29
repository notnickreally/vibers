/**
 * One pass of the watchlist, all the way onto the wall.
 *
 * Three things have to happen together — read the watchlist, ask both platforms
 * who is on air, write the answer into the shared wall — and two callers need
 * all three: the wall's own sourcing run, which every visitor triggers, and the
 * panel's **Check now**, which an admin presses to see it work. A second
 * spelling of this sequence is how the two surfaces end up disagreeing about
 * what "watched" means, so there is one.
 *
 * **The merge is `mergeSourced`'s, unchanged.** Watched channels come through
 * the same door keyword sourcing does, which buys the whole contract for free:
 * a stream someone added by hand is never evicted, a stream anyone threw off
 * never comes back, sourced entries are capped and swept after a day. It also
 * means taking a watched channel's stream off the wall *sticks* — it is
 * recorded as dismissed, so the next sweep does not put it straight back.
 */

import "server-only";

import type { Metadata, Stream } from "./stream";
import type { WatchlistResult } from "./watch";
import { sweepWatchlist } from "./watch-live";
import { listWatched, noteLive } from "./watchlist";
import * as wall from "./wall";

export interface SourcedRun {
  streams: Stream[];
  watchlist: WatchlistResult;
}

/**
 * Fold the watchlist — and anything else already found — onto the wall.
 *
 * `also` is keyword sourcing's result, and it goes **first** in the list handed
 * to `mergeSourced` on purpose. That function unshifts what it is given, so the
 * entries at the *end* end up at the front of the sourced run and are the ones
 * that survive `MAX_SOURCED`. Watched channels are somebody's explicit choice
 * and keyword finds are a guess, so when there is not room for both, the choice
 * wins.
 */
export async function sourceWatched(also: Metadata[], now: number): Promise<SourcedRun> {
  const sweep = await sweepWatchlist(await listWatched());
  const streams = await wall.applySourced([...also, ...sweep.streams], now);
  // Only for the panel to render — nothing branches on it. Written after the
  // wall, because a failure here must not cost the streams we just put up.
  await noteLive(sweep.liveKeys, now);
  return { streams, watchlist: sweep.result };
}
