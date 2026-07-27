import { describe, expect, it } from "vitest";
import {
  coverLabel,
  type Cover,
  fractionOf,
  LAG_WINDOW_SECONDS,
  LIVE_EDGE_SLACK,
  lagBehind,
  liveEdge,
  type LiveLag,
  liveOffsetLabel,
  type Phase,
  pictureCover,
  seekWindow,
  shiftLag,
  trackLag,
} from "./player-time";
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

/**
 * The live edge, and the bug that made this suite necessary.
 *
 * Every number in here that looks arbitrary was measured against real YouTube
 * live embeds rather than chosen: the `+3600` padding on `getDuration()`, the
 * 597.1 → 592.1 decay, and the 17.7 / 622.3 / 25.4 lag samples all come off
 * instrumented players. See the note above `LAG_WINDOW_SECONDS` in
 * `player-time.ts` for how they were taken.
 */

/** Feed a whole series of (time, playhead) readings in, in order. */
function replay(readings: Array<[at: number, position: number]>): LiveLag | null {
  let lag: LiveLag | null = null;
  for (const [at, position] of readings) lag = trackLag(lag, at, position);
  return lag;
}

describe("trackLag", () => {
  it("seeds the floor and the latest reading from the first sample", () => {
    const lag = trackLag(null, 1000, 900);
    expect(lag?.latest).toBe(100);
    expect(lag?.floor).toBe(100);
    expect(lagBehind(lag)).toBe(0);
  });

  it("holds the floor steady while playback rides the live edge", () => {
    // Playing normally: the clock and the playhead advance together, so the
    // slack between them never changes and nothing is behind anything.
    const lag = replay([
      [1000, 900],
      [1001, 901],
      [1002, 902],
      [1060, 960],
    ]);
    expect(lagBehind(lag)).toBe(0);
  });

  it("reads a rewind as being behind, by exactly the distance rewound", () => {
    const lag = replay([
      [1000, 900],
      [1001, 301], // rewound 600s
      [1002, 302],
    ]);
    expect(lagBehind(lag)).toBe(600);
  });

  it("does not let the offset decay while the viewer sits still", () => {
    // The second half of the original bug. With a frozen edge and an advancing
    // playhead the offset shrank 1s per second — measured 597.1s, then 592.1s
    // five seconds later — implying the viewer was catching up on a live
    // stream by watching it at normal speed.
    const lag = replay([
      [1000, 900],
      [1001, 301],
      [1006, 306], // five seconds later, still 600 behind
    ]);
    expect(lagBehind(lag)).toBe(600);
  });

  it("lets the floor rise again once the low sample ages out of the window", () => {
    // A latency regime change — an ABR switch off a low-latency ladder, or a
    // deeper buffer after a stall — must not strand the viewer permanently
    // amber with a Live button that is lit but does nothing.
    const early = trackLag(null, 1000, 900); // slack 100
    let lag = early;
    // Steady state settles 25s worse, then the old floor ages out.
    for (let i = 1; i <= LAG_WINDOW_SECONDS + 10; i++) {
      lag = trackLag(lag, 1000 + i, 900 + i - 25);
    }
    expect(lagBehind(early)).toBe(0);
    expect(lagBehind(lag)).toBe(0);
    expect(lag?.floor).toBe(125);
  });

  it("drops samples that have aged past the window", () => {
    const lag = replay([
      [1000, 900],
      [1000 + LAG_WINDOW_SECONDS + 1, 900 + LAG_WINDOW_SECONDS + 1],
    ]);
    expect(lag?.samples).toHaveLength(1);
  });

  it("rejects a reading from a clock it does not understand", () => {
    // The failure this guard exists for: an epoch value meeting a floor taken
    // from a monotonic clock. Nine orders of magnitude apart, it rendered an
    // offset of -472000:00:00 and lit every behind-live control.
    const good = trackLag(null, 1000, 900);
    expect(trackLag(good, 1000, -1.7e9)).toBe(good);
    expect(trackLag(good, 1.7e12, 900)).toBe(good);
    expect(lagBehind(trackLag(good, 1.7e12, 900))).toBe(0);
  });

  it("ignores readings that are not finite", () => {
    const lag = trackLag(null, 1000, 900);
    expect(trackLag(lag, Number.NaN, 900)).toBe(lag);
    expect(trackLag(lag, 1001, Number.POSITIVE_INFINITY)).toBe(lag);
    expect(trackLag(null, Number.NaN, Number.NaN)).toBeNull();
  });

  it("returns the previous estimate by identity when nothing moved", () => {
    // Polled four times a second — a fresh object each tick would re-render the
    // whole player for no change. Same contract `narrowDvr` already keeps.
    const lag = trackLag(null, 1000, 900);
    expect(trackLag(lag, 1001, 901)).toBe(lag);
  });
});

describe("lagBehind", () => {
  it("is zero for a lag it has nothing to say about", () => {
    expect(lagBehind(null)).toBe(0);
  });

  it("never reports a negative offset", () => {
    expect(lagBehind({ samples: [], latest: 10, floor: 40 })).toBe(0);
  });

  it("survives a poisoned estimate rather than propagating NaN", () => {
    expect(lagBehind({ samples: [], latest: Number.NaN, floor: 0 })).toBe(0);
  });
});

describe("shiftLag", () => {
  it("moves the offset with a seek the player has not performed yet", () => {
    // The bar's fill is 1 - behind/span, so `position` cancels out of it and
    // moving the playhead alone moves nothing on screen. Without this the knob
    // sits frozen through the buffering after a seek and then jumps.
    const lag = trackLag(null, 1000, 900);
    expect(lagBehind(shiftLag(lag, 600))).toBe(600);
  });

  it("leaves an estimate alone when there is nothing to shift", () => {
    const lag = trackLag(null, 1000, 900);
    expect(shiftLag(lag, 0)).toBe(lag);
    expect(shiftLag(null, 600)).toBeNull();
    expect(shiftLag(lag, Number.NaN)).toBe(lag);
  });
});

describe("liveEdge", () => {
  it("ignores the duration YouTube reports for a live stream", () => {
    // THE BUG. Measured on 9 of 12 real live player instances: `getDuration()`
    // is frozen and sits ~3600s ahead of the playhead. Taking it as the live
    // edge is what produced the -55:52 on a viewer who was watching live.
    const position = 11_230_278;
    const edge = liveEdge({ live: true, duration: position + 3600, position, behind: 0 });
    expect(edge).toBe(position);
  });

  it("keeps believing the duration for a recording", () => {
    expect(liveEdge({ live: false, duration: 500, position: 120, behind: 0 })).toBe(500);
    // A live stream's playhead must never leak into a VOD's window.
    expect(liveEdge({ live: false, duration: 500, position: 120, behind: 90 })).toBe(500);
  });

  it("puts the edge ahead of the playhead by however far behind we are", () => {
    expect(liveEdge({ live: true, duration: 0, position: 1000, behind: 600 })).toBe(1600);
  });

  it("is total over the inputs a starting player actually produces", () => {
    expect(liveEdge({ live: true, duration: 0, position: 0, behind: 0 })).toBe(0);
    expect(liveEdge({ live: false, duration: 0, position: 0, behind: 0 })).toBe(0);
    expect(liveEdge({ live: true, duration: 0, position: Number.NaN, behind: 0 })).toBe(0);
    expect(liveEdge({ live: true, duration: 0, position: 100, behind: Number.NaN })).toBe(100);
    expect(liveEdge({ live: true, duration: 0, position: 100, behind: -50 })).toBe(100);
  });
});

describe("the live seek bar, end to end", () => {
  // The four acceptance checks, replayed as the readings a real player gave.
  // The lag samples are the ones measured off an instrumented live embed:
  // 17.7s at the edge, 622.3s after a ten-minute rewind, 25.4s after go-live.
  const DURATION = 11_233_858; // frozen, and ~3600s ahead of the playhead
  const DVR = { dvrSeconds: 4 * 60 * 60, isLive: true };

  function render(position: number, behind: number) {
    const edge = liveEdge({ live: true, duration: DURATION, position, behind });
    const win = seekWindow({ edge, ...DVR });
    return { label: liveOffsetLabel(position, edge), fraction: fractionOf(position, win) };
  }

  it("says LIVE and fills the bar for a viewer at the live edge", () => {
    const lag = replay([
      [1000, 11_230_493],
      [1005, 11_230_498],
    ]);
    const { label, fraction } = render(11_230_498, lagBehind(lag));
    expect(label).toBe("LIVE");
    expect(fraction).toBe(1);
  });

  it("reports the true offset for a viewer who rewound ten minutes", () => {
    const lag = replay([
      [1000, 11_230_493],
      [1008, 11_229_901], // rewound
      [1013, 11_229_906], // and still rewound five seconds later
    ]);
    const { label, fraction } = render(11_229_906, lagBehind(lag));
    expect(label).toBe("-10:00");
    expect(fraction).toBeLessThan(1);
    expect(fraction).toBeCloseTo(1 - 600 / (4 * 60 * 60), 5);
  });

  it("clears the offset again once the viewer returns to the edge", () => {
    const lag = replay([
      [1000, 11_230_493],
      [1008, 11_229_901],
      [1013, 11_229_906],
      [1021, 11_230_511], // go-live landed us back at the edge
    ]);
    // A resync lands a few seconds short of where it aimed — measured at 7.7s
    // against a real stream, 3s here — which is well inside the slack, so it
    // reads LIVE and the remaining sliver of a four-hour window is invisible.
    expect(lagBehind(lag)).toBeLessThan(LIVE_EDGE_SLACK);
    const { label, fraction } = render(11_230_511, lagBehind(lag));
    expect(label).toBe("LIVE");
    expect(fraction).toBeGreaterThan(0.999);
  });

  it("puts the viewer exactly on the edge once go-live re-baselines", () => {
    // What the component actually does: `goLive` drops the estimate rather than
    // trusting the seek to land on the floor, so the next sample starts a fresh
    // one. Without this a resync that settled ten or twenty seconds back would
    // leave the Live button lit after being pressed, inviting a re-seek loop.
    const { label, fraction } = render(11_230_511, lagBehind(null));
    expect(label).toBe("LIVE");
    expect(fraction).toBe(1);
  });

  it("never shows the -55:52 the old edge produced", () => {
    // Stated as the symptom rather than the mechanism, so this fails for any
    // regression that reintroduces it — not only the one we know about.
    for (let watched = 0; watched < 600; watched += 30) {
      const position = 11_230_278 + watched;
      const { label, fraction } = render(position, 0);
      expect(label).toBe("LIVE");
      expect(label).not.toContain("-");
      expect(fraction).toBe(1);
    }
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
