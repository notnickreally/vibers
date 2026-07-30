import { describe, expect, it } from "vitest";
import {
  DRUM_FLOOR,
  DRUM_HUB,
  DRUM_RADIUS,
  DRUM_SHRINK,
  DRUM_TILT,
  drumOffset,
  drumSeat,
  drumTransform,
} from "./wheel";

/**
 * The rule this file exists to pin: the wheel turns the way a barrel turns.
 *
 * A drum that leans the wrong way is not a subtle bug — it is a wheel turning
 * inside out, tiles rising out of the screen at the rim instead of falling into
 * it — and it is invisible in a diff and easy to talk yourself into in a
 * screenshot. So the sign of the tilt and the sign of the depth are asserted
 * outright, and everything else is asserted as a shape: monotonic away from the
 * axle, symmetric about it, and never off the ends of its range.
 */

const RIM = [0.25, 0.5, 0.75, 1] as const;

describe("drumOffset", () => {
  it("puts a tile level with the axle at nought", () => {
    expect(drumOffset(300, 300, 200)).toBe(0);
  });

  it("measures in half-heights, so the same wheel is the same wheel at any size", () => {
    // Half way to the rim is half way to the rim, whether the rim is 100px away
    // or 400 — this is what lets one set of constants dress every layout.
    expect(drumOffset(350, 300, 100)).toBeCloseTo(0.5);
    expect(drumOffset(500, 300, 400)).toBeCloseTo(0.5);
  });

  it("is negative above the axle and positive below it", () => {
    expect(drumOffset(100, 300, 200)).toBeLessThan(0);
    expect(drumOffset(500, 300, 200)).toBeGreaterThan(0);
  });

  it("saturates at the rim instead of running away past it", () => {
    // Tiles this far out are behind the wheel's mask. Letting the number grow
    // buys nothing and costs a rotation the compositor has to take seriously.
    expect(drumOffset(9000, 300, 200)).toBe(1);
    expect(drumOffset(-9000, 300, 200)).toBe(-1);
  });

  it("answers nought rather than a NaN for a wheel with no height", () => {
    // A hidden or not-yet-laid-out container measures zero, and one NaN here
    // becomes `transform: rotateX(NaNdeg)` on every tile at once.
    for (const half of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(drumOffset(300, 100, half)).toBe(0);
    }
    expect(drumOffset(Number.NaN, 100, 200)).toBe(0);
    expect(drumOffset(300, Number.NaN, 200)).toBe(0);
  });
});

describe("drumSeat", () => {
  it("leaves the tile at the axle flat, near and fully lit", () => {
    const seat = drumSeat(0);
    expect(seat.tilt).toBe(0);
    expect(seat.depth).toBe(0);
    expect(seat.scale).toBe(1);
    expect(seat.opacity).toBe(1);
    expect(seat.hub).toBe(true);
  });

  it("turns the top edge away above the axle and the bottom edge away below it", () => {
    // The load-bearing sign. Positive `rotateX` pushes an element's top edge
    // away from the viewer, so a tile above the axle — a negative offset — has
    // to come out positive.
    expect(drumSeat(-0.5).tilt).toBeGreaterThan(0);
    expect(drumSeat(0.5).tilt).toBeLessThan(0);
  });

  it("sends both rims behind the axle, never in front of it", () => {
    for (const offset of RIM) {
      expect(drumSeat(offset).depth).toBeLessThan(0);
      expect(drumSeat(-offset).depth).toBeLessThan(0);
    }
  });

  it("is symmetric about the axle", () => {
    // A wheel with a heavier half is a wheel you notice, and not for the
    // reason you wanted.
    for (const offset of RIM) {
      const above = drumSeat(-offset);
      const below = drumSeat(offset);
      expect(above.tilt).toBeCloseTo(-below.tilt);
      expect(above.depth).toBeCloseTo(below.depth);
      expect(above.scale).toBeCloseTo(below.scale);
      expect(above.opacity).toBeCloseTo(below.opacity);
      expect(above.hub).toBe(below.hub);
    }
  });

  it("recedes, shrinks and dims monotonically away from the axle", () => {
    let last = drumSeat(0);
    for (const offset of RIM) {
      const seat = drumSeat(offset);
      expect(seat.depth).toBeLessThan(last.depth);
      expect(seat.scale).toBeLessThan(last.scale);
      expect(seat.opacity).toBeLessThanOrEqual(last.opacity);
      last = seat;
    }
  });

  it("reaches the full turn and the full radius exactly at the rim", () => {
    const rim = drumSeat(1);
    expect(rim.tilt).toBeCloseTo(-DRUM_TILT);
    expect(rim.scale).toBeCloseTo(1 - DRUM_SHRINK);
    const fallen = (1 - Math.cos((DRUM_TILT * Math.PI) / 180)) * DRUM_RADIUS;
    expect(rim.depth).toBeCloseTo(-fallen, 1);
  });

  it("never draws a tile all the way out, and never draws one twice over", () => {
    // Every tile on the wheel is a link. One at zero opacity is a link nobody
    // can aim at, and an opacity over 1 is a style the browser throws away.
    for (const offset of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]) {
      const seat = drumSeat(offset);
      expect(seat.opacity).toBeGreaterThanOrEqual(DRUM_FLOOR);
      expect(seat.opacity).toBeLessThanOrEqual(1);
      expect(seat.scale).toBeGreaterThan(0);
    }
  });

  it("saturates past the rim rather than folding over", () => {
    expect(drumSeat(4)).toEqual(drumSeat(1));
    expect(drumSeat(-4)).toEqual(drumSeat(-1));
  });

  it("seats a NaN at the axle", () => {
    expect(drumSeat(Number.NaN)).toEqual(drumSeat(0));
  });

  it("lights the detent only around the axle", () => {
    expect(drumSeat(DRUM_HUB).hub).toBe(true);
    expect(drumSeat(-DRUM_HUB).hub).toBe(true);
    expect(drumSeat(DRUM_HUB + 0.01).hub).toBe(false);
    expect(drumSeat(1).hub).toBe(false);
  });
});

describe("drumTransform", () => {
  it("pushes back before it turns", () => {
    // Rotate first and the translate rides the tilted axis, walking the tile
    // sideways out of the column. The order here is the fix for that.
    const css = drumTransform(drumSeat(0.5));
    expect(css.indexOf("translateZ")).toBeLessThan(css.indexOf("rotateX"));
    expect(css.indexOf("rotateX")).toBeLessThan(css.indexOf("scale"));
  });

  it("writes a transform the browser will take, with real units", () => {
    expect(drumTransform(drumSeat(0))).toBe("translateZ(0px) rotateX(0deg) scale(1)");
    expect(drumTransform(drumSeat(-1))).toMatch(
      /^translateZ\(-\d+(\.\d+)?px\) rotateX\(\d+(\.\d+)?deg\) scale\(0\.\d+\)$/,
    );
  });

  it("never emits a NaN, whatever it is handed", () => {
    for (const offset of [Number.NaN, Number.POSITIVE_INFINITY, -0, 12]) {
      expect(drumTransform(drumSeat(offset))).not.toContain("NaN");
    }
  });
});
