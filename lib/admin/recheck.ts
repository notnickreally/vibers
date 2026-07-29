/**
 * The panel's own clock.
 *
 * Every check the panel can do, it could already do — **Re-ask liveness** and
 * **Check now** have been two buttons since the watchlist landed. What was
 * missing is that they only happened when somebody pressed them, so a panel
 * left open on a wall-mounted screen showed whatever was true when it loaded.
 * This is the small pure part of fixing that: how often the cycle runs, and how
 * it says when it last ran.
 *
 * It lives apart from the component for the usual two reasons — the interval is
 * a number both the timer and the copy on screen have to agree about, and a
 * sentence is worth pinning in a test when it is the only evidence a viewer has
 * that anything is happening at all.
 *
 * No `server-only` here: this is imported by a client component.
 */

/** How often the panel re-checks everything it lists. Five minutes, as asked. */
export const RECHECK_MS = 5 * 60 * 1000;

/** The same interval in the copy on screen, so the two cannot drift apart. */
export const RECHECK_LABEL = "5 minutes";

/**
 * A wall clock, UTC and deterministic.
 *
 * `day()` in the panel takes the same line: a locale-formatted time would be
 * one string on the server and another in the browser, and this one is only
 * ever set after a cycle, so it never renders during hydration anyway. Being
 * unambiguous about the zone matters more than being local — the operator
 * reading it is checking that a thing happened recently, not what time it is.
 */
export function clock(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 19)} UTC`;
}

export interface Cycle {
  /** How many streams were on the wall when liveness was re-asked. */
  urls: number;
  /** Watched channels found on air by the sweep that ran first. */
  found: number;
  /** When the cycle finished. */
  at: number;
}

/**
 * What the cycle did, in one line.
 *
 * Deliberately reports the count it actually checked rather than "done": the
 * point of an automatic check is that nobody is watching it, so the readout has
 * to be specific enough to prove it ran against something.
 */
export function cycleNote(cycle: Cycle): string {
  const when = clock(cycle.at);
  const urls =
    cycle.urls === 0
      ? "Nothing on the wall to check"
      : `Checked ${cycle.urls} ${cycle.urls === 1 ? "URL" : "URLs"}`;
  const found =
    cycle.found === 0
      ? ""
      : ` · ${cycle.found} watched ${cycle.found === 1 ? "channel" : "channels"} on air, and up`;
  return `${urls}${found} · ${when}`;
}

/** The same line when the cycle couldn't finish. Says so rather than going quiet. */
export function failedNote(at: number): string {
  return `Couldn't finish the check · ${clock(at)} · trying again in ${RECHECK_LABEL}`;
}
