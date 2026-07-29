/**
 * The site's favicon, server-side. Every read and write of the one row is here.
 *
 * Same shape as `lib/watchlist.ts` and `lib/wall.ts`: the deciding half is pure
 * and lives in `lib/icon.ts` where the suite can reach it without a database,
 * and this is the persistence around it. What is worth saying out loud is the
 * behaviour, not the SQL:
 *
 * **There is one favicon and it belongs to everybody.** It is not a preference
 * of the admin who uploaded it and it is not stored in anyone's browser — the
 * same row answers every visitor's tab, which is exactly what the wall being
 * shared already means for everything else here.
 *
 * **Restoring the default is a delete, not a second upload.** The shipped
 * `public/icon.png` is always what an empty table means, so a deployment with
 * no row and a fresh Neon branch (every preview gets one) both look right
 * without anybody having to seed anything.
 *
 * The reads are split in two on purpose. `iconVersion` is what the public route
 * asks on a conditional request, and it is a single `BIGINT` — the image itself
 * is only ever fetched when a browser actually needs the bytes.
 */

import "server-only";

import { db, ready } from "./db";
import type { IconBytes, IconSummary } from "./icon";

export type { IconSummary };

/** The primary key. Constant, because there is one favicon. */
const ROW = "site";

interface Row {
  content_type: string;
  data: string;
  bytes: number;
  width: number | null;
  height: number | null;
  updated_at: string | number;
  updated_by: string | null;
}

/** The image, and what it is. Only the route that answers a browser wants this. */
export interface StoredIcon extends IconSummary {
  data: string;
}

/**
 * A row, as everything above the database sees it.
 *
 * `BIGINT` arrives as a string over Neon's HTTP driver, so `updated_at` is
 * converted back — it is compared as a number and rendered as a date. The
 * content type is narrowed rather than cast: only `lib/icon.ts` decides what a
 * favicon may be, and a row written by an older, looser version of this file
 * should not be able to widen that after the fact.
 */
function toSummary(row: Omit<Row, "data">): IconSummary {
  return {
    contentType: row.content_type === "image/svg+xml"
      ? "image/svg+xml"
      : row.content_type === "image/x-icon"
        ? "image/x-icon"
        : "image/png",
    bytes: Number(row.bytes),
    width: row.width === null ? undefined : Number(row.width),
    height: row.height === null ? undefined : Number(row.height),
    updatedAt: Number(row.updated_at),
    updatedBy: row.updated_by ?? undefined,
  };
}

/** When the icon last changed, or `null` for the shipped default. One small column. */
export async function iconVersion(): Promise<number | null> {
  await ready();
  const rows = (await db()`
    SELECT updated_at FROM site_icon WHERE id = ${ROW}
  `) as { updated_at: string | number }[];
  return rows[0] ? Number(rows[0].updated_at) : null;
}

/** What is up, without the image. `null` means the default is up. */
export async function iconSummary(): Promise<IconSummary | null> {
  await ready();
  const rows = (await db()`
    SELECT content_type, bytes, width, height, updated_at, updated_by
    FROM site_icon WHERE id = ${ROW}
  `) as Omit<Row, "data">[];
  return rows[0] ? toSummary(rows[0]) : null;
}

/** The image itself. `null` means the default is up. */
export async function readIcon(): Promise<StoredIcon | null> {
  await ready();
  const rows = (await db()`SELECT * FROM site_icon WHERE id = ${ROW}`) as Row[];
  const row = rows[0];
  return row ? { ...toSummary(row), data: row.data } : null;
}

/**
 * Put an icon up, replacing whatever was there.
 *
 * An upsert on the constant key, so this is the same statement whether it is
 * the first favicon this deployment has had or the fifth. `updated_at` moves
 * every time, which is what makes every browser's cached copy stale — see
 * `iconTag` in `lib/icon.ts`.
 */
export async function putIcon(entry: {
  icon: IconBytes;
  updatedBy?: string;
  now: number;
}): Promise<IconSummary> {
  await ready();
  const { icon } = entry;
  const rows = (await db()`
    INSERT INTO site_icon (id, content_type, data, bytes, width, height, updated_at, updated_by)
    VALUES (${ROW}, ${icon.contentType}, ${icon.data}, ${icon.bytes},
            ${icon.width ?? null}, ${icon.height ?? null},
            ${entry.now}::bigint, ${entry.updatedBy ?? null})
    ON CONFLICT (id) DO UPDATE SET
      content_type = EXCLUDED.content_type,
      data         = EXCLUDED.data,
      bytes        = EXCLUDED.bytes,
      width        = EXCLUDED.width,
      height       = EXCLUDED.height,
      updated_at   = EXCLUDED.updated_at,
      updated_by   = EXCLUDED.updated_by
    RETURNING content_type, bytes, width, height, updated_at, updated_by
  `) as Omit<Row, "data">[];
  return toSummary(rows[0]);
}

/** Go back to the icon this repo ships with. Returns whether there was one to clear. */
export async function clearIcon(): Promise<boolean> {
  await ready();
  const rows = (await db()`DELETE FROM site_icon WHERE id = ${ROW} RETURNING id`) as {
    id: string;
  }[];
  return rows.length > 0;
}
