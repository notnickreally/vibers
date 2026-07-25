/** Formatting helpers. All deterministic — safe to call during render. */

export function timecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function shortDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Audience read, in the site's own words. Never "bad" — a run that is losing
 * is still worth watching, and telling people otherwise would be a lie.
 */
export function vibeLabel(vibe: number): string {
  if (vibe >= 85) return "locked in";
  if (vibe >= 65) return "cooking";
  if (vibe >= 45) return "grinding";
  if (vibe >= 30) return "in the weeds";
  return "cooked";
}

export function vibeTone(vibe: number): string {
  if (vibe >= 65) return "text-add";
  if (vibe >= 45) return "text-amber";
  return "text-del";
}

/** Deterministic poster gradient per run, so cards feel composed not random. */
export const POSTER_TONES = [
  "linear-gradient(148deg, #2a1740 0%, #120c1c 58%, #1a1026 100%)",
  "linear-gradient(148deg, #3a2410 0%, #150e1a 58%, #21142a 100%)",
  "linear-gradient(148deg, #0f2f30 0%, #0e1220 58%, #17182c 100%)",
  "linear-gradient(148deg, #3a1220 0%, #170d1a 58%, #241426 100%)",
  "linear-gradient(148deg, #182a1c 0%, #101418 58%, #1b1a2a 100%)",
] as const;
