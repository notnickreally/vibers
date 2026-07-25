/**
 * There is no auth in this prototype, so the signed-in viber is a constant.
 * It matters for one rule in particular: **a run's picture is opt-in.** Only the
 * broadcaster can attach a feed to their own run — a viewer cannot point someone
 * else's run page at a video, and a crafted `?v=` link cannot do it either.
 */
export const CURRENT_VIBER = "nocturne";

export function isOwnRun(handle: string): boolean {
  return handle === CURRENT_VIBER;
}

/** Where a takedown or misattribution report goes. */
export const RIGHTS_CONTACT = "rights@vibers.tv";
