/**
 * The side wall's drum, as arithmetic.
 *
 * The strip of everyone else's streams beside a playing one used to be a flat
 * list living in the page's own scroll, and that was the fault: scrolling the
 * wall *was* scrolling the page, so far enough down it and the stream you came
 * to watch had left the screen. The fix is to give the wall its own axle — and
 * once it has one it is a wheel, not a list, so it should read as one.
 *
 * A wheel needs three things said about every tile on it: how far it has turned
 * away from you, how deep that puts it, and how much light reaches it there.
 * That is all this file does. Two functions, no DOM: the component measures
 * where a tile is, this decides how it should be drawn. Kept out of the
 * component because the geometry is the part that can be quietly wrong, and a
 * wrong sign here is a wheel that turns inside out — which is exactly the kind
 * of thing a test can pin and a screenshot can only hint at.
 *
 * Every value below is a decision about a barrel about a foot across seen from
 * a couple of feet away. They are not tuned to a design; they are tuned to a
 * shape you would recognise.
 */

/** How far the tile at the rim has turned away from the viewer, in degrees. */
export const DRUM_TILT = 46;

/**
 * The drum's radius in pixels — which is to say how far *behind* the axle the
 * rim sits. Read together with the container's `perspective`: this is the depth
 * the vanishing point converts into the taper that makes the wheel look round.
 */
export const DRUM_RADIUS = 260;

/**
 * How much smaller a rim tile is drawn, on top of the shrinking that
 * perspective already does for free. Perspective alone is a weak effect at a
 * sane vanishing distance; this is what makes the centre tile read as the near
 * one rather than merely the flat one.
 */
export const DRUM_SHRINK = 0.16;

/**
 * How much light a rim tile loses. Applied to the *square* of the distance from
 * the axle, so the middle of the wheel stays fully lit and the fall-off happens
 * where the surface is actually turning away — the way a real cylinder shades,
 * and the reason the wheel reads as depth rather than as a fade.
 */
export const DRUM_FADE = 0.9;

/** No tile is ever drawn all the way out. Something you cannot see at all is
 * something you cannot aim at, and every tile here is a link. */
export const DRUM_FLOOR = 0.12;

/**
 * How close to the axle a tile has to be to count as the one the wheel is
 * pointing at. Deliberately generous: this drives a detent, not a selection, so
 * it should light up as you arrive rather than snap on at the last pixel.
 */
export const DRUM_HUB = 0.22;

/** Where a tile sits on the drum, and how to draw it there. */
export interface DrumSeat {
  /** Signed distance from the axle: 0 dead centre, -1 the top rim, +1 the bottom. */
  offset: number;
  /** Degrees about the horizontal axis — the tile's own turn away from the viewer. */
  tilt: number;
  /** Pixels along the viewer's z, never positive: the rim is behind the axle. */
  depth: number;
  scale: number;
  opacity: number;
  /** True while this is the tile at the axle. */
  hub: boolean;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Transforms are written every animation frame, so they are rounded — a string
 * that stops changing is a style the browser stops re-parsing. Negative zero is
 * folded back to zero on the way out: `-0` is the same angle as `0` and prints
 * the same, but it is not the same value to anything comparing seats. */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Where a tile sits on the drum, given its centre and the wheel's.
 *
 * Measured in half-heights rather than pixels so the wheel is the same wheel at
 * any size: ±1 is the rim wherever the rim happens to be. Past the rim it
 * saturates instead of running away — tiles out there are behind the mask, and
 * a 4000-degree rotation is not more hidden than a 46-degree one, only slower
 * to composite.
 */
export function drumOffset(tileCentre: number, axle: number, halfHeight: number): number {
  if (!Number.isFinite(halfHeight) || halfHeight <= 0) return 0;
  if (!Number.isFinite(tileCentre) || !Number.isFinite(axle)) return 0;
  return clamp((tileCentre - axle) / halfHeight, -1, 1);
}

/** The whole of the drum's geometry, from one number. */
export function drumSeat(offset: number): DrumSeat {
  const seated = Number.isFinite(offset) ? clamp(offset, -1, 1) : 0;
  const away = Math.abs(seated);
  const angle = (seated * DRUM_TILT * Math.PI) / 180;
  return {
    offset: seated,
    // Above the axle a tile leans its *top* away from you; below it, its bottom
    // — the two halves of a barrel turning past. CSS's positive `rotateX` pushes
    // the top edge away, and `seated` is negative above the axle, so the sign
    // flips here rather than at the call site.
    tilt: round(-seated * DRUM_TILT, 2),
    // Straight off the circle: how far the surface has fallen back by the time
    // it has turned this far. Zero at the axle by construction, which is what
    // keeps the centre tile flush with the front of the wheel.
    depth: round(-(1 - Math.cos(angle)) * DRUM_RADIUS, 1),
    scale: round(1 - DRUM_SHRINK * away, 3),
    opacity: round(Math.max(DRUM_FLOOR, 1 - DRUM_FADE * away * away), 3),
    hub: away <= DRUM_HUB,
  };
}

/**
 * The seat as a CSS transform.
 *
 * Order is the whole meaning: pushed back along the viewer's z *first*, in the
 * wheel's space, and only then turned about its own middle. Rotate first and
 * the translate follows the tilted axis, which walks the tile sideways out of
 * the column.
 */
export function drumTransform(seat: DrumSeat): string {
  return `translateZ(${seat.depth}px) rotateX(${seat.tilt}deg) scale(${seat.scale})`;
}
