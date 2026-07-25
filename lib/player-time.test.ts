import { describe, expect, it } from "vitest";
import { coverLabel, type Cover, type Phase, pictureCover } from "./player-time";
import { posterFallbackUrl, posterUrl } from "./youtube";

/**
 * The rule, stated once as a test: a frame that exists is shown, and nothing
 * is laid over it. Anything that returns "slate" for a phase with a frame
 * under it is a regression, and that is what the matrix below pins.
 */

const PHASES: Phase[] = ["cold", "cued", "buffering", "playing", "paused", "ended"];

function cover(phase: Phase, opts: { hasPlayed?: boolean; failure?: boolean } = {}): Cover {
  return pictureCover({ phase, hasPlayed: opts.hasPlayed ?? false, failure: opts.failure });
}

describe("pictureCover", () => {
  it("lays nothing at all over a phase that has a frame under it", () => {
    // The acceptance check, as a check. Every phase that can have decoded
    // footage behind it shows that footage, uncovered.
    for (const phase of ["buffering", "playing", "paused"] as Phase[]) {
      expect(cover(phase, { hasPlayed: true })).toBe("none");
    }
  });

  it("shows the poster before there is any decoded picture", () => {
    expect(cover("cold")).toBe("poster");
    expect(cover("cued")).toBe("poster");
    expect(cover("buffering")).toBe("poster");
  });

  it("does not fall back to the poster on a mid-stream stall", () => {
    // The bug this latch exists to prevent: twenty minutes into a live stream
    // the network hiccups, YouTube reports BUFFERING, and the cover art slams
    // over footage the viewer was watching.
    expect(cover("buffering", { hasPlayed: true })).toBe("none");
  });

  it("leaves a running picture completely uncovered", () => {
    expect(cover("playing", { hasPlayed: true })).toBe("none");
  });

  it("leaves a paused picture completely alone", () => {
    // Measured against a real embed with the old cover switched off: pausing
    // raises no YouTube chrome whatsoever, at 1.5s or at 8s. There is nothing
    // here to cover, and a cover would be the only thing on the picture.
    expect(cover("paused", { hasPlayed: true })).toBe("none");
  });

  it("leaves a resume or a seek to settle on its own", () => {
    // The chrome a state change does raise fades itself out inside three
    // seconds. Riding it out beats covering it.
    expect(cover("playing", { hasPlayed: true })).toBe("none");
    expect(cover("buffering", { hasPlayed: true })).toBe("none");
  });

  it("slates the two states with nothing left to protect", () => {
    expect(cover("ended", { hasPlayed: true })).toBe("slate");
    expect(cover("playing", { hasPlayed: true, failure: true })).toBe("slate");
  });

  it("lets a failure win over every phase", () => {
    for (const phase of PHASES) {
      expect(cover(phase, { hasPlayed: true, failure: true })).toBe("slate");
    }
  });

  it("is total over the whole input space", () => {
    const allowed: Cover[] = ["poster", "none", "slate"];
    for (const phase of PHASES) {
      for (const hasPlayed of [false, true]) {
        for (const failure of [false, true]) {
          expect(allowed).toContain(cover(phase, { hasPlayed, failure }));
        }
      }
    }
  });

  it("clears the slate again once a spurious ENDED is followed by playback", () => {
    // `goLive` deliberately targets edge - 2 because landing on the edge can
    // trip ENDED, so a transient one is a known event here.
    expect(cover("ended", { hasPlayed: true })).toBe("slate");
    expect(cover("playing", { hasPlayed: true })).toBe("none");
  });
});

describe("coverLabel", () => {
  it("says nothing over a running picture", () => {
    expect(coverLabel({ phase: "playing", hasPlayed: true })).toBe("");
  });

  it("names the paused state", () => {
    expect(coverLabel({ phase: "paused", hasPlayed: true })).toBe("Paused");
  });

  it("points at the play button once autoplay has clearly been refused", () => {
    expect(coverLabel({ phase: "cued", hasPlayed: false })).toBe("Tuning in…");
    expect(coverLabel({ phase: "cued", hasPlayed: false, stalled: true })).toBe(
      "Press play to start",
    );
  });

  it("prefers YouTube's own refusal to anything we would say", () => {
    const failure = "This channel doesn't allow its stream to play outside YouTube.";
    expect(coverLabel({ phase: "paused", hasPlayed: true, failure })).toBe(failure);
  });
});

describe("poster variants", () => {
  it("asks for 16:9 frames, never the pillarboxed 4:3 one", () => {
    // hqdefault is 480x360 with black bars baked into the image, and
    // maxresdefault is missing for most live streams — both are wrong here.
    expect(posterUrl("dQw4w9WgXcQ")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg");
    expect(posterFallbackUrl("dQw4w9WgXcQ")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
    );
    expect(posterUrl("x")).not.toContain("hqdefault");
    expect(posterUrl("x")).not.toContain("maxres");
  });
});
