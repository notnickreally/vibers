/**
 * What the site's favicon is allowed to be. The deciding half, and pure.
 *
 * The favicon used to be `app/icon.png` — a file in the build, which meant
 * changing it was a commit and a deploy, and meant every deployment of this
 * repo wore the same face. It is a row in Neon now, put there from the admin
 * panel, and that is the whole point: **the tab is shared the way the wall is
 * shared.** One admin changes it and everybody's tab changes, because there is
 * one icon and it does not live in anybody's browser.
 *
 * Everything a caller decides about an upload is decided here, so the suite can
 * drive it without a database and without a request:
 *
 * - **The file is identified by its bytes, never by its name or its type.** A
 *   browser's `File.type` is a guess from the extension, and `data:` URLs carry
 *   whatever the sender wrote. Both are attacker-controlled and neither is
 *   checked by the thing that eventually renders the icon, so the declared type
 *   has to agree with the magic number or the upload is refused.
 * - **Three formats.** PNG, ICO, SVG — what a browser will actually put in a
 *   tab. Refusing a JPEG is not squeamishness: it has no transparency, so it
 *   arrives as a square photo in the corner of a dark tab strip.
 * - **A cap, and a small one.** A favicon is a 16–64px image; anything past
 *   `MAX_ICON_BYTES` is somebody's logo at print resolution, and it would be
 *   fetched by every visitor of every page.
 *
 * Isomorphic on purpose — no `Buffer`, no `server-only`. The panel imports this
 * to refuse a bad file before it is ever uploaded, and the routes import it to
 * refuse the same file again on the server, where it counts.
 */

/** How big a favicon may be. 64 KB is generous for a tab icon and mean for a logo. */
export const MAX_ICON_BYTES = 64 * 1024;

/** What a browser will put in a tab, and therefore all this accepts. */
export const ICON_TYPES = ["image/png", "image/x-icon", "image/svg+xml"] as const;

export type IconType = (typeof ICON_TYPES)[number];

/** For the file picker's `accept`, so the wrong file is hard to pick in the first place. */
export const ICON_ACCEPT =
  ".png,.ico,.svg,image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml";

/** How each accepted format is named on screen. */
export const ICON_TYPE_LABEL: Record<IconType, string> = {
  "image/png": "PNG",
  "image/x-icon": "ICO",
  "image/svg+xml": "SVG",
};

/** The icon this repo ships with, served whenever nothing has been uploaded. */
export const DEFAULT_ICON_PATH = "/icon.png";

/** The one URL the site's `<link rel="icon">` ever points at. */
export const ICON_PATH = "/api/icon";

/** An icon, as everything above this file carries it: base64, and its own type. */
export interface IconBytes {
  contentType: IconType;
  /** Base64, without the `data:` preamble — what goes in the database column. */
  data: string;
  bytes: number;
  /** Known for PNG and ICO. An SVG has no intrinsic pixel size worth reporting. */
  width?: number;
  height?: number;
}

/**
 * The current icon, without the image — what the panel renders and what the
 * admin route answers with.
 *
 * It lives in this module rather than in `lib/site-icon.ts` for a boundary
 * reason: the panel is a client component, and `lib/site-icon.ts` is
 * `server-only`. A type-only import would be erased, but the shape a client
 * renders has no business being declared behind that door in the first place.
 */
export interface IconSummary {
  contentType: IconType;
  bytes: number;
  width?: number;
  height?: number;
  updatedAt: number;
  updatedBy?: string;
}

export type IconRefusal = "empty" | "malformed" | "unsupported" | "mismatched" | "too-big";

/**
 * Why an upload was refused, said plainly and said the same on both sides.
 *
 * The panel checks the file before sending it and the route checks it again;
 * sharing the sentences is what stops the two answers from disagreeing about
 * the same file.
 */
export const ICON_REFUSAL: Record<IconRefusal, string> = {
  empty: "Pick a file first.",
  malformed: "That didn't arrive as an image. Pick the file again.",
  unsupported:
    "A favicon here is a PNG, an ICO, or an SVG. Nothing else goes in a tab well enough to be worth it.",
  mismatched:
    "That file's contents aren't what its name says they are. Nothing was changed — the bytes decide, not the extension.",
  "too-big": `Bigger than ${sizeLabel(MAX_ICON_BYTES)}. A favicon is a 16 to 64 pixel image, and this one is fetched by every visitor of every page.`,
};

/** Bytes, for a human. Whole kilobytes past 1 KB — a favicon needs no more precision. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
}

function isIconType(value: string): value is IconType {
  return (ICON_TYPES as readonly string[]).includes(value);
}

/**
 * Decode base64 without `Buffer`.
 *
 * `atob` is in Node and in every browser, which is what keeps this module
 * importable from a client component — see the header. It throws on input that
 * isn't base64, and that throw is the malformed case.
 *
 * The return type names its backing buffer because the icon route hands these
 * bytes straight to a `Response`, and `BodyInit` will not take a view over an
 * `ArrayBufferLike` — only over an `ArrayBuffer`, which is what this allocates.
 */
export function decodeIcon(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

/**
 * What the bytes actually are. `null` for anything this doesn't accept.
 *
 * PNG and ICO have unambiguous magic numbers. SVG is text and has none, so it
 * is sniffed the way every other reader sniffs it: find an `<svg` root inside
 * the opening of the document, past a BOM, an XML declaration, a doctype or a
 * comment. The window is bounded so a megabyte of leading whitespace isn't a
 * search.
 */
export function sniffIcon(bytes: Uint8Array): IconType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // `00 00 01 00` is an icon directory; `00 00 02 00` is a cursor, which is the
  // same container and is not a favicon.
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 1024));
  return /<svg[\s>]/i.test(head) ? "image/svg+xml" : null;
}

/**
 * A PNG's pixel size, read out of its IHDR.
 *
 * Only so the panel can say "40 × 40" next to the icon it is showing. Nothing
 * branches on it — an operator who wants a 512px favicon is allowed one, they
 * just deserve to be told that is what they uploaded.
 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** An ICO's first entry. `0` in the byte means 256, which is the format's one quirk. */
function icoSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 8) return null;
  const dimension = (byte: number) => (byte === 0 ? 256 : byte);
  return { width: dimension(bytes[6]), height: dimension(bytes[7]) };
}

export type IconUpload = { ok: true; icon: IconBytes } | { ok: false; reason: IconRefusal };

/**
 * Read a `data:` URL into something storable, or refuse it.
 *
 * This is the whole of the validation, and it is deliberately the same call on
 * the panel and in the route. The panel's copy exists to give an answer without
 * a round trip; the route's copy is the one that decides, because a panel is
 * just a browser and `curl` never opens one.
 */
export function parseIconUpload(input: unknown): IconUpload {
  if (typeof input !== "string" || input.trim() === "") return { ok: false, reason: "empty" };

  const match = /^data:([^;,]+)(;[^,]*)?;base64,(.*)$/s.exec(input.trim());
  if (!match) return { ok: false, reason: "malformed" };

  const declared = match[1].toLowerCase();
  const payload = match[3];
  if (payload === "") return { ok: false, reason: "empty" };

  // Base64 is 4 characters per 3 bytes, so the size is known before the decode.
  // Refusing here means a 40 MB upload is not decoded into memory to be told no.
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  if (Math.floor((payload.length * 3) / 4) - padding > MAX_ICON_BYTES) {
    return { ok: false, reason: "too-big" };
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeIcon(payload);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_ICON_BYTES) return { ok: false, reason: "too-big" };

  const sniffed = sniffIcon(bytes);
  if (!sniffed) return { ok: false, reason: "unsupported" };

  // A declared type this doesn't accept is only "unsupported" when the bytes
  // agree with it. A JPEG announcing itself as a PNG is the other refusal, and
  // the two are worth telling apart on screen.
  if (isIconType(normalizeType(declared)) && normalizeType(declared) !== sniffed) {
    return { ok: false, reason: "mismatched" };
  }

  const size =
    sniffed === "image/png"
      ? pngSize(bytes)
      : sniffed === "image/x-icon"
        ? icoSize(bytes)
        : null;
  return {
    ok: true,
    icon: {
      contentType: sniffed,
      data: payload,
      bytes: bytes.length,
      width: size?.width,
      height: size?.height,
    },
  };
}

/** The spellings of ICO that browsers send, folded onto the one this stores. */
function normalizeType(type: string): string {
  return type === "image/vnd.microsoft.icon" || type === "image/ico" ? "image/x-icon" : type;
}

/**
 * The tag on the icon a visitor already has.
 *
 * The site's `<link rel="icon">` is a fixed URL — putting a version in it would
 * mean reading the database to render every page, which would cost the wall its
 * static render for a 2 KB image. So the URL never changes and *this* does: the
 * icon's own `updated_at`, quoted as an `ETag`, which is what turns the next
 * request into a 304 or a new picture. `null` — nothing uploaded — is the
 * shipped default, and it has a tag too.
 */
export function iconTag(version: number | null): string {
  return version === null ? '"icon-default"' : `"icon-${version}"`;
}

/**
 * Does the browser already have this icon? The `If-None-Match` read.
 *
 * Pure, and here rather than in the route, because it is the one decision on
 * the public favicon path that can be wrong in a way nobody notices: answer
 * "yes" too eagerly and an admin's change never reaches a returning visitor.
 * So the parsing is spelled out — a list, weak tags (`W/"…"`, which is what a
 * proxy that re-compressed the response sends back), and `*`.
 */
export function tagMatches(header: string | null | undefined, tag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((value) => value.trim().replace(/^W\//, ""))
    .some((value) => value === "*" || value === tag);
}

/**
 * A cache-busted URL, for the one screen that cannot wait for revalidation.
 *
 * Only the panel uses it. An operator who just uploaded an icon and is looking
 * at the preview must see the file they picked, not the one the browser cached
 * a minute ago — everywhere else, `max-age` doing its job is the correct
 * behaviour and this would defeat it.
 */
export function iconPreviewUrl(version: number | null): string {
  return version === null ? DEFAULT_ICON_PATH : `${ICON_PATH}?v=${version}`;
}
