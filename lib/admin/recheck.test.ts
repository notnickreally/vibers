import { describe, expect, it } from "vitest";
import { clock, cycleNote, failedNote, RECHECK_MS } from "./recheck";

/**
 * The readout is the whole evidence.
 *
 * An automatic check has no moment — it happens to a page nobody is touching —
 * so the line it leaves behind is the only way anyone knows it ran, and the
 * only way to tell "checked nothing" apart from "checked everything". These
 * pin it: the counts are real counts, the zero cases say what they mean, and
 * the clock is UTC rather than whatever the render happened to be on.
 */

const AT = Date.UTC(2026, 6, 29, 14, 3, 7);

describe("RECHECK_MS", () => {
  it("is five minutes", () => {
    expect(RECHECK_MS).toBe(300_000);
  });
});

describe("clock", () => {
  it("is UTC, to the second", () => {
    expect(clock(AT)).toBe("14:03:07 UTC");
  });

  it("does not drift with the machine's zone", () => {
    // The same instant, read twice — a locale formatter would not promise this.
    expect(clock(AT)).toBe(clock(new Date(AT).getTime()));
  });
});

describe("cycleNote", () => {
  it("reports what it checked", () => {
    expect(cycleNote({ urls: 12, found: 0, at: AT })).toBe("Checked 12 URLs · 14:03:07 UTC");
  });

  it("counts one URL as one", () => {
    expect(cycleNote({ urls: 1, found: 0, at: AT })).toBe("Checked 1 URL · 14:03:07 UTC");
  });

  it("says so when the wall is empty rather than claiming a check", () => {
    expect(cycleNote({ urls: 0, found: 0, at: AT })).toBe(
      "Nothing on the wall to check · 14:03:07 UTC",
    );
  });

  it("mentions watched channels the sweep put up", () => {
    expect(cycleNote({ urls: 12, found: 1, at: AT })).toBe(
      "Checked 12 URLs · 1 watched channel on air, and up · 14:03:07 UTC",
    );
    expect(cycleNote({ urls: 12, found: 3, at: AT })).toBe(
      "Checked 12 URLs · 3 watched channels on air, and up · 14:03:07 UTC",
    );
  });
});

describe("failedNote", () => {
  it("admits the failure and says when it tries again", () => {
    expect(failedNote(AT)).toBe(
      "Couldn't finish the check · 14:03:07 UTC · trying again in 5 minutes",
    );
  });
});
