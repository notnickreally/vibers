/**
 * The two puzzle layers, reduced to strings.
 *
 * Layer two is a patch bay: three cables between six sources and six
 * destinations. Layer three is a vectorscope dial: three notches out of twelve,
 * in order. Neither is a password, and this file is where that stops being a
 * vibe and becomes a number — 2400 patch sets, 1728 dial combinations. They are
 * a second and a third factor, and the lockout in `lib/admin/store.ts` is what
 * makes them worth anything at all.
 *
 * What this file actually does is *canonicalise*. The browser sends an array of
 * whatever the operator dragged, in whatever order they dragged it; the stored
 * digest is of one exact string. So a patch set is sorted before it is encoded
 * — that is what makes layer two order-independent — and a dial combination is
 * not, because a combination lock you can enter backwards is a worse lock.
 *
 * Everything here is pure and total: unknown input returns `null` rather than
 * throwing, because every caller of it is a route handler holding a request
 * body it has no reason to trust.
 */

/** The six things you can patch from. Index is the wire format; the label is decoration. */
export const SOURCES = ["CAM 1", "CAM 2", "VTR", "TITLE", "REMOTE", "BARS"] as const;

/** The six things you can patch to. */
export const DESTINATIONS = ["PGM", "PVW", "AUX 1", "AUX 2", "AUX 3", "REC"] as const;

/** How many cables the patch bay wants. Not one, not four. */
export const PATCH_COUNT = 3;

/** Notches around the vectorscope, clock-face style. */
export const NOTCHES = 12;

/** How many notches make a combination. */
export const DIAL_LENGTH = 3;

export interface Patch {
  source: number;
  destination: number;
}

function isIndex(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < limit;
}

/**
 * Read a patch set off the wire and encode it canonically.
 *
 * Exactly three cables, each source used once and each destination used once —
 * which is also what the physical thing does, since a jack holds one plug. The
 * sort is the whole point: `[a, b, c]` and `[c, a, b]` are the same patch bay,
 * so they have to be the same string before they are the same digest.
 */
export function canonicalPatches(input: unknown): string | null {
  if (!Array.isArray(input) || input.length !== PATCH_COUNT) return null;

  const patches: Patch[] = [];
  const sourcesUsed = new Set<number>();
  const destinationsUsed = new Set<number>();

  for (const entry of input) {
    if (typeof entry !== "object" || entry === null) return null;
    const { source, destination } = entry as { source?: unknown; destination?: unknown };
    if (!isIndex(source, SOURCES.length)) return null;
    if (!isIndex(destination, DESTINATIONS.length)) return null;
    if (sourcesUsed.has(source) || destinationsUsed.has(destination)) return null;
    sourcesUsed.add(source);
    destinationsUsed.add(destination);
    patches.push({ source, destination });
  }

  patches.sort((a, b) => a.source - b.source);
  return `patch:${patches.map((p) => `${p.source}>${p.destination}`).join(",")}`;
}

/**
 * Read a dial combination off the wire and encode it.
 *
 * No sort, and repeats are allowed — a real combination lock lets you stop on
 * the same number twice, and forbidding it would only shrink the space.
 */
export function canonicalDial(input: unknown): string | null {
  if (!Array.isArray(input) || input.length !== DIAL_LENGTH) return null;
  for (const notch of input) {
    if (!isIndex(notch, NOTCHES)) return null;
  }
  return `dial:${(input as number[]).join("-")}`;
}

/** Handles are the one identifier an admin types twice, so they are narrow. */
const HANDLE = /^[a-z0-9_-]{3,32}$/;

/**
 * Normalise and check a handle.
 *
 * Lowercased before it is checked rather than rejected for case, so signing up
 * as `Nick` and signing in as `nick` are the same person — and, because the
 * column is unique, so that they cannot be two.
 */
export function canonicalHandle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const handle = input.trim().toLowerCase();
  return HANDLE.test(handle) ? handle : null;
}

/** The shortest passphrase this panel accepts, and the longest it will hash. */
export const MIN_PASSPHRASE = 10;
export const MAX_PASSPHRASE = 256;

export function validPassphrase(input: unknown): string | null {
  if (typeof input !== "string") return null;
  return input.length >= MIN_PASSPHRASE && input.length <= MAX_PASSPHRASE ? input : null;
}
