import { describe, expect, it } from "vitest";
import { coverLabel, type Cover, maskGlyph, type Phase, pictureCover } from "./player-time";
import { posterFallbackUrl, posterUrl } from "./youtube";

/**
 * The rule this whole ticket bought, stated once as a test: the footage is
 * never hidden as a whole. Anything that returns "slate" for a phase with a
 * frame under it is a regression, and that is what the matrix below pins.
 */

const PHASES: Phase[] = ["cold", "cued", "buffering", "playing", "paused", "ended"];

function cover(
  phase: Phase,
  opts: { hasPlayed?: boolean; settling?: boolean; failure?: boolean } = {},
): Cover {
  return pictureCover({
    phase,
    hasPlayed: opts.hasPlayed ?? false,
    settling: opts.settling ?? false,
    failure: opts.failure,
  });
}

describe("pictureCover", () => {
  it("never blacks out a phase that has a frame under it", () => {
    // The acceptance check, as a check. Every phase that can have decoded
    // footage behind it, in every combination of the other two inputs.
    for (const phase of ["buffering", "playing", "paused"] as Phase[]) {
      for (const settling of [false, true]) {
        expect(cover(phase, { hasPlayed: true, settling })).not.toBe("slate");
      }
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

  it("masks a running picture only while a state change is settling", () => {
    expect(cover("playing", { hasPlayed: true, settling: true })).toBe("mask");
  });

  it("masks a paused picture rather than blacking it out", () => {
    // The headline requirement: paused freezes on the frame, and the frame
    // stays visible. A mask covers where YouTube paints; it is not a slate.
    expect(cover("paused", { hasPlayed: true })).toBe("mask");
    expect(cover("paused", { hasPlayed: true, settling: true })).toBe("mask");
  });

  it("keeps masking a paused picture no matter how long it sits there", () => {
    // Pause chrome does not time out the way resume chrome does, so the mask
    // must come off the phase and never off the settling window.
    expect(cover("paused", { hasPlayed: true, settling: false })).toBe("mask");
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
    const allowed: Cover[] = ["poster", "mask", "none", "slate"];
    for (const phase of PHASES) {
      for (const hasPlayed of [false, true]) {
        for (const settling of [false, true]) {
          for (const failure of [false, true]) {
            expect(allowed).toContain(cover(phase, { hasPlayed, settling, failure }));
          }
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

describe("maskGlyph", () => {
  it("says pause on the one state that is paused", () => {
    expect(maskGlyph("paused")).toBe("pause");
  });

  it("says play everywhere else the mask goes up", () => {
    // A resume and a seek both land in playback, and a cued or cold picture
    // is one press away from it. None of them are a pause.
    for (const phase of ["cold", "cued", "buffering", "playing"] as Phase[]) {
      expect(maskGlyph(phase)).toBe("play");
    }
  });

  it("always has something to say wherever a mask is drawn", () => {
    // The disc is never blank: an unmarked dark circle reads as a smudge over
    // a hole, and that was the complaint the mask exists to answer.
    const glyphs = ["play", "pause"];
    for (const phase of PHASES) {
      for (const settling of [false, true]) {
        if (cover(phase, { hasPlayed: true, settling }) !== "mask") continue;
        expect(glyphs).toContain(maskGlyph(phase));
      }
    }
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
