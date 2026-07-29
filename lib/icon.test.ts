import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeIcon,
  iconPreviewUrl,
  iconTag,
  MAX_ICON_BYTES,
  parseIconUpload,
  pngSize,
  sizeLabel,
  sniffIcon,
  tagMatches,
} from "./icon";

/**
 * What is allowed to become the site's face.
 *
 * The load-bearing case is the second `describe`: this is the one place in the
 * app where a file chosen by a person ends up rendered in every visitor's
 * browser chrome, and the only thing standing between those two facts is that
 * the bytes are identified rather than believed. A filename is a claim. A
 * `data:` URL's declared MIME type is a claim. Both arrive from the same place
 * the file does, so the tests below are mostly about disagreeing with them.
 */

/** The smallest real PNG there is: one pixel, and a valid IHDR to read it from. */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** An icon directory with one 32×32 entry. Enough header to be identified. */
const ICO_32 = Buffer.from([
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x20, 0x20, 0x00, 0x00, 0x01, 0x00, 0x20, 0x00,
]);

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>');

/** A JPEG's first three bytes. Legal in an `<img>`, refused as a favicon. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function dataUrl(type: string, bytes: Buffer): string {
  return `data:${type};base64,${bytes.toString("base64")}`;
}

describe("the formats a tab can actually wear", () => {
  it("takes a PNG, and reads its size out of the IHDR", () => {
    const result = parseIconUpload(dataUrl("image/png", PNG_1x1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.icon.contentType).toBe("image/png");
    expect(result.icon.bytes).toBe(PNG_1x1.byteLength);
    expect(result.icon).toMatchObject({ width: 1, height: 1 });
    // What goes in the column is the base64 payload alone — no `data:` preamble,
    // because the route serves it with a `Content-Type` header instead.
    expect(result.icon.data).toBe(PNG_1x1.toString("base64"));
  });

  it("takes an ICO, under either of the names a browser gives it", () => {
    for (const declared of ["image/x-icon", "image/vnd.microsoft.icon"]) {
      const result = parseIconUpload(dataUrl(declared, ICO_32));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.icon.contentType).toBe("image/x-icon");
      expect(result.icon).toMatchObject({ width: 32, height: 32 });
    }
  });

  it("takes an SVG, including one that opens with a declaration", () => {
    const declared = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${SVG.toString()}`);
    for (const bytes of [SVG, declared]) {
      const result = parseIconUpload(dataUrl("image/svg+xml", bytes));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.icon.contentType).toBe("image/svg+xml");
      // No intrinsic pixel size, and none is invented for the panel to render.
      expect(result.icon.width).toBeUndefined();
    }
  });

  it("refuses a JPEG, which has no transparency and no business in a tab", () => {
    expect(parseIconUpload(dataUrl("image/jpeg", JPEG))).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("ships a default icon that is itself a PNG this would accept", () => {
    const shipped = readFileSync(new URL("../public/icon.png", import.meta.url));
    const result = parseIconUpload(dataUrl("image/png", shipped));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.icon).toMatchObject({ contentType: "image/png", width: 40, height: 40 });
  });
});

describe("the bytes decide, not the name on the file", () => {
  it("identifies the type from the magic number, whatever was declared", () => {
    // A PNG that arrived calling itself an ICO is still a PNG, and is stored
    // and served as one — the extension was always the least reliable claim.
    const result = parseIconUpload(dataUrl("application/octet-stream", PNG_1x1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.icon.contentType).toBe("image/png");
  });

  it("refuses a file whose contents contradict an accepted declared type", () => {
    expect(parseIconUpload(dataUrl("image/svg+xml", PNG_1x1))).toEqual({
      ok: false,
      reason: "mismatched",
    });
  });

  it("refuses anything that is not one of the three, however it is labelled", () => {
    expect(parseIconUpload(dataUrl("image/png", JPEG))).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(parseIconUpload(dataUrl("image/png", Buffer.from("not an image at all")))).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("does not mistake a cursor for an icon, though they share a container", () => {
    const cursor = Buffer.from([0x00, 0x00, 0x02, 0x00, 0x01, 0x00, 0x20, 0x20]);
    expect(sniffIcon(cursor)).toBeNull();
  });
});

describe("what is refused before anything is stored", () => {
  it("refuses nothing at all", () => {
    expect(parseIconUpload("")).toEqual({ ok: false, reason: "empty" });
    expect(parseIconUpload(undefined)).toEqual({ ok: false, reason: "empty" });
    expect(parseIconUpload(null)).toEqual({ ok: false, reason: "empty" });
    expect(parseIconUpload("data:image/png;base64,")).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses something that is not a data URL", () => {
    expect(parseIconUpload("https://example.com/icon.png")).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(parseIconUpload("data:image/png,notbase64")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("refuses an image past the cap on its length, without decoding it", () => {
    // Deliberately built as a base64 string rather than as bytes: the size check
    // reads the payload's length so an enormous upload is never materialized.
    const oversized = "A".repeat(Math.ceil(((MAX_ICON_BYTES + 1024) * 4) / 3));
    expect(parseIconUpload(`data:image/png;base64,${oversized}`)).toEqual({
      ok: false,
      reason: "too-big",
    });
  });

  it("lets an image right up to the cap through the length check", () => {
    // The cap is on bytes, so a payload that decodes to exactly the limit is
    // rejected for what it is (not a PNG), not for how big it is. 64 KB is
    // 3 × 21845 + 1 bytes, so its base64 is 21846 groups ending in two pads.
    const atCap = `${"A".repeat(21846 * 4 - 2)}==`;
    expect(decodeIcon(atCap).byteLength).toBe(MAX_ICON_BYTES);
    expect(parseIconUpload(`data:image/png;base64,${atCap}`)).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});

describe("the version a browser revalidates against", () => {
  it("tags the shipped default and every upload apart", () => {
    expect(iconTag(null)).toBe('"icon-default"');
    expect(iconTag(1_700_000_000_000)).toBe('"icon-1700000000000"');
    // Two uploads a millisecond apart are two tags, which is the whole job.
    expect(iconTag(1)).not.toBe(iconTag(2));
  });

  it("points the panel's preview at the version it just saved", () => {
    expect(iconPreviewUrl(null)).toBe("/icon.png");
    expect(iconPreviewUrl(1_700_000_000_000)).toBe("/api/icon?v=1700000000000");
  });

  it("tells a browser that already has the current icon, and only that browser", () => {
    const tag = iconTag(7);
    expect(tagMatches(tag, tag)).toBe(true);
    // A proxy that re-encoded the response weakens the tag; it is still a match.
    expect(tagMatches(`W/${tag}`, tag)).toBe(true);
    expect(tagMatches(`${iconTag(6)}, ${tag}`, tag)).toBe(true);
    expect(tagMatches("*", tag)).toBe(true);
  });

  it("sends the image whenever there is any doubt at all", () => {
    const tag = iconTag(7);
    // The case this exists for: the icon changed, so the tag the browser is
    // holding is last version's and it must not be told 304.
    expect(tagMatches(iconTag(6), tag)).toBe(false);
    expect(tagMatches(iconTag(null), tag)).toBe(false);
    expect(tagMatches("", tag)).toBe(false);
    expect(tagMatches(null, tag)).toBe(false);
    expect(tagMatches(undefined, tag)).toBe(false);
    expect(tagMatches("icon-7", tag)).toBe(false);
  });
});

describe("the small print", () => {
  it("decodes base64 back to the bytes that went in", () => {
    expect(Buffer.from(decodeIcon(PNG_1x1.toString("base64")))).toEqual(PNG_1x1);
  });

  it("reads a PNG's size, and refuses to guess at anything else", () => {
    expect(pngSize(new Uint8Array(PNG_1x1))).toEqual({ width: 1, height: 1 });
    expect(pngSize(new Uint8Array(ICO_32))).toBeNull();
    expect(pngSize(new Uint8Array(PNG_1x1.subarray(0, 12)))).toBeNull();
  });

  it("says a size the way a person reads one", () => {
    expect(sizeLabel(512)).toBe("512 B");
    expect(sizeLabel(2048)).toBe("2.0 KB");
    expect(sizeLabel(MAX_ICON_BYTES)).toBe("64 KB");
  });
});
