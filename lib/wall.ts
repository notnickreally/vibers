/**
 * The wall, server-side. Every read and write of the shared store lives here.
 *
 * This is the half of `lib/stream.ts` that used to talk to `localStorage`. It
 * now talks to Neon, and it runs on the server — the browser reaches it
 * through `app/api/streams`, never directly. The deciding half of the store
 * (`shelf`, `partition`, `mergeStatuses`, `mergeSourced`) stayed pure and
 * stayed where it was; this file is the persistence around it, so the rules
 * the suite pins are the same rules that run against the database.
 *
 * One consequence of the wall being shared is worth stating plainly, because
 * it is a behaviour change rather than an implementation detail: **taking a
 * stream off takes it off for everyone.** So does clearing the sourced ones.
 * That is what a shared wall means — the same thing that makes someone else's
 * stream show up on yours makes your ✕ show up on theirs.
 */

import "server-only";

import { db, ready } from "./db";
import { MAX_DISMISSED, mergeSourced } from "./discover";
import type { Metadata, Status, Stream } from "./stream";
import { mergeStatuses } from "./stream";

/** How many streams the wall holds. Oldest fall off the bottom. */
export const MAX = 60;

interface Row {
  video_id: string;
  title: string;
  channel: string;
  channel_url: string | null;
  thumbnail: string;
  description: string | null;
  is_live: boolean | null;
  viewers: number | null;
  ended_at: string | null;
  added_at: string | number;
  sourced_at: string | number | null;
}

/**
 * A row, as the wall sees it.
 *
 * `undefined` rather than `null` throughout, because the shape the rest of the
 * app decides over is `Stream` — and `isLive` in particular is a *tri-state*
 * whose third state is absence. A `null` there would be a fourth spelling of
 * "we don't know" that `shelf()` has never been told about.
 *
 * `BIGINT` arrives as a string over Neon's HTTP driver (Postgres `int8` does
 * not fit a JS number in the general case), so the timestamps are converted
 * back rather than passed through — `addedAt` is compared numerically by the
 * sweep in `mergeSourced`.
 */
function toStream(row: Row): Stream {
  return {
    videoId: row.video_id,
    title: row.title,
    channel: row.channel,
    channelUrl: row.channel_url ?? undefined,
    thumbnail: row.thumbnail,
    description: row.description ?? undefined,
    isLive: row.is_live ?? undefined,
    viewers: row.viewers ?? undefined,
    endedAt: row.ended_at ?? undefined,
    addedAt: Number(row.added_at),
    sourcedAt: row.sourced_at === null ? undefined : Number(row.sourced_at),
  };
}

export async function listStreams(): Promise<Stream[]> {
  await ready();
  const rows = (await db()`
    SELECT * FROM streams ORDER BY added_at DESC LIMIT ${MAX}
  `) as Row[];
  return rows.map(toStream);
}

export async function findStream(videoId: string): Promise<Stream | undefined> {
  await ready();
  const rows = (await db()`SELECT * FROM streams WHERE video_id = ${videoId}`) as Row[];
  return rows[0] ? toStream(rows[0]) : undefined;
}

/**
 * Put a stream up, or refresh the one already there.
 *
 * An upsert rather than an insert, and the conflict branch deliberately does
 * **not** touch `added_at` or `sourced_at`: re-adding a stream someone else
 * already put up should update its title and liveness, not reorder the wall
 * under them. Adding by hand does clear `sourced_at` — choosing a stream
 * yourself is what takes it out of the sweep's reach.
 */
export async function addStream(meta: Metadata, now: number): Promise<Stream[]> {
  await ready();
  const sourcedAt = typeof meta.sourcedAt === "number" ? meta.sourcedAt : null;
  await db()`
    INSERT INTO streams (
      video_id, title, channel, channel_url, thumbnail, description,
      is_live, viewers, ended_at, added_at, sourced_at
    ) VALUES (
      ${meta.videoId}, ${meta.title}, ${meta.channel}, ${meta.channelUrl ?? null},
      ${meta.thumbnail}, ${meta.description ?? null}, ${meta.isLive ?? null},
      ${meta.viewers ?? null}, ${meta.endedAt ?? null}, ${now}, ${sourcedAt}
    )
    ON CONFLICT (video_id) DO UPDATE SET
      title = EXCLUDED.title,
      channel = EXCLUDED.channel,
      channel_url = EXCLUDED.channel_url,
      thumbnail = EXCLUDED.thumbnail,
      description = EXCLUDED.description,
      is_live = EXCLUDED.is_live,
      viewers = EXCLUDED.viewers,
      ended_at = EXCLUDED.ended_at,
      sourced_at = EXCLUDED.sourced_at
  `;
  // Putting a stream back up is also how you undo having thrown it off, so the
  // dismissal has to go with it — otherwise the id someone just chose is still
  // on the list that stops auto-sourcing offering it.
  await db()`DELETE FROM dismissed_streams WHERE video_id = ${meta.videoId}`;
  await trim();
  return listStreams();
}

export async function removeStream(videoId: string, now: number): Promise<Stream[]> {
  await ready();
  const existing = await findStream(videoId);
  // Same rule as before the move: taking a *sourced* stream off has to be
  // remembered, because the search behind it is cached for hours and the next
  // sourcing run would otherwise put the same id straight back.
  if (existing?.sourcedAt !== undefined) await dismiss([videoId], now);
  await db()`DELETE FROM streams WHERE video_id = ${videoId}`;
  return listStreams();
}

/** Take every sourced stream off at once, and remember each one. */
export async function clearSourced(now: number): Promise<Stream[]> {
  await ready();
  const rows = (await db()`
    SELECT video_id FROM streams WHERE sourced_at IS NOT NULL
  `) as { video_id: string }[];
  const ids = rows.map((r) => r.video_id);
  if (ids.length === 0) return listStreams();
  await dismiss(ids, now);
  await db()`DELETE FROM streams WHERE video_id = ANY(${ids})`;
  return listStreams();
}

export async function listDismissed(): Promise<string[]> {
  await ready();
  const rows = (await db()`
    SELECT video_id FROM dismissed_streams ORDER BY dismissed_at DESC LIMIT ${MAX_DISMISSED}
  `) as { video_id: string }[];
  return rows.map((r) => r.video_id);
}

/**
 * Fold fresh liveness in.
 *
 * The merge itself is `mergeStatuses` — the same total function the suite
 * pins — so its contract holds unchanged here: matched by id, nothing added,
 * an absent id left exactly as it was, `viewers` cleared the moment a stream
 * stops being live. Only rows whose values actually moved are written, which
 * on a wall that is mostly stable is usually none of them.
 */
export async function applyStatuses(statuses: Record<string, Status>): Promise<Stream[]> {
  await ready();
  const before = await listStreams();
  const after = mergeStatuses(before, statuses);

  const writes = after.filter((next, i) => {
    const prev = before[i];
    return (
      prev.isLive !== next.isLive ||
      prev.viewers !== next.viewers ||
      prev.endedAt !== next.endedAt
    );
  });
  if (writes.length === 0) return before;

  const sql = db();
  await sql.transaction(
    writes.map(
      (s) => sql`
        UPDATE streams
        SET is_live = ${s.isLive ?? null},
            viewers = ${s.viewers ?? null},
            ended_at = ${s.endedAt ?? null}
        WHERE video_id = ${s.videoId}
      `,
    ),
  );
  return after;
}

/**
 * Fold what auto-sourcing found into the wall.
 *
 * `mergeSourced` decides — it holds the rules about what may be evicted, what
 * is swept, and what has been dismissed — and this writes the difference
 * between what it was handed and what it returned. A diff rather than a
 * wholesale rewrite, so a stream someone else added between the read and the
 * write keeps its own `added_at` instead of being reinserted at this instant.
 */
export async function applySourced(found: Metadata[], now: number): Promise<Stream[]> {
  await ready();
  const before = await listStreams();
  const after = mergeSourced(before, found, await listDismissed(), now).slice(0, MAX);

  const keep = new Set(after.map((s) => s.videoId));
  const dropped = before.filter((s) => !keep.has(s.videoId)).map((s) => s.videoId);
  if (dropped.length > 0) await db()`DELETE FROM streams WHERE video_id = ANY(${dropped})`;

  const had = new Set(before.map((s) => s.videoId));
  for (const stream of after) {
    if (!had.has(stream.videoId)) await addStream(stream, stream.addedAt);
  }
  return listStreams();
}

/** Remember ids that were thrown off, capped so the table can't grow forever. */
async function dismiss(videoIds: string[], now: number): Promise<void> {
  if (videoIds.length === 0) return;
  const sql = db();
  await sql.transaction(
    videoIds.map(
      (id) => sql`
        INSERT INTO dismissed_streams (video_id, dismissed_at)
        VALUES (${id}, ${now})
        ON CONFLICT (video_id) DO UPDATE SET dismissed_at = EXCLUDED.dismissed_at
      `,
    ),
  );
  await sql`
    DELETE FROM dismissed_streams
    WHERE video_id NOT IN (
      SELECT video_id FROM dismissed_streams ORDER BY dismissed_at DESC LIMIT ${MAX_DISMISSED}
    )
  `;
}

/** Keep the wall at `MAX`. Oldest out first — the same cap the browser store had. */
async function trim(): Promise<void> {
  await db()`
    DELETE FROM streams
    WHERE video_id NOT IN (
      SELECT video_id FROM streams ORDER BY added_at DESC LIMIT ${MAX}
    )
  `;
}
