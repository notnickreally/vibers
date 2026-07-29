/**
 * The watchlist, server-side. Every read and write of the table lives here.
 *
 * Same shape as `lib/wall.ts`: the deciding half is pure and lives in
 * `lib/watch.ts` where the suite can reach it, and this is the persistence
 * around it. The rules that file pins — what a key is, what parses, what is
 * refused — are the rules the database gets.
 *
 * Two things follow from the wall being shared, and they are worth saying
 * plainly because they are behaviour rather than implementation:
 *
 * **The watchlist is shared too.** A channel one admin adds is watched for
 * everybody, and a channel one admin removes stops being watched for
 * everybody. There is no per-operator list.
 *
 * **Removing a channel does not take its streams down.** What is already on the
 * wall stays there, keeps refreshing, and sweeps itself out after
 * `SOURCED_TTL_MS` like any other sourced entry — or an admin takes it off by
 * hand. Un-watching says "stop adding this one", not "undo what you added",
 * because those are two different intentions and only one of them was asked
 * for.
 */

import "server-only";

import { db, ready } from "./db";
import { MAX_WATCHED, type Watched, type WatchTarget, watchKey } from "./watch";

interface Row {
  key: string;
  provider: string;
  channel_id: string;
  name: string;
  input: string;
  url: string;
  added_at: string | number;
  added_by: string | null;
  last_live_at: string | number | null;
}

/**
 * A row, as everything above the database sees it.
 *
 * `BIGINT` arrives as a string over Neon's HTTP driver, so the timestamps are
 * converted back rather than passed through — `lastLiveAt` is rendered as a
 * date and `addedAt` is sorted on.
 */
function toWatched(row: Row): Watched {
  return {
    key: row.key,
    provider: row.provider === "twitch" ? "twitch" : "youtube",
    id: row.channel_id,
    name: row.name,
    input: row.input,
    url: row.url,
    addedAt: Number(row.added_at),
    addedBy: row.added_by ?? undefined,
    lastLiveAt: row.last_live_at === null ? undefined : Number(row.last_live_at),
  };
}

export async function listWatched(): Promise<Watched[]> {
  await ready();
  const rows = (await db()`
    SELECT * FROM watched_channels ORDER BY added_at DESC LIMIT ${MAX_WATCHED}
  `) as Row[];
  return rows.map(toWatched);
}

export type AddResult = { ok: true; watched: Watched } | { ok: false; reason: "full" };

/**
 * Watch a channel, or refresh the one already watched.
 *
 * The cap is enforced **inside the `INSERT`**, for the reason `lib/admin/store.ts`
 * spells out: Neon's HTTP driver has no session to hold a transaction across
 * two statements, so `SELECT count(*)` then `INSERT` has a gap that two
 * simultaneous adds both walk through. `INSERT … SELECT … WHERE (SELECT count(*))
 * < MAX` has no gap.
 *
 * The conflict branch is what makes re-adding an already-watched channel
 * harmless: the name and the input are refreshed (a channel may have renamed
 * itself since), `added_at` is not (so the list keeps its order under whoever
 * is reading it), and the cap is not consulted at all — an upsert of a row that
 * already exists cannot take the count past the limit.
 */
export async function watch(entry: {
  target: WatchTarget;
  name: string;
  input: string;
  url: string;
  addedBy?: string;
  now: number;
}): Promise<AddResult> {
  await ready();
  const key = watchKey(entry.target);
  const rows = (await db()`
    INSERT INTO watched_channels (key, provider, channel_id, name, input, url, added_at, added_by)
    SELECT ${key}, ${entry.target.provider}, ${entry.target.id}, ${entry.name},
           ${entry.input}, ${entry.url}, ${entry.now}::bigint, ${entry.addedBy ?? null}
    WHERE (SELECT count(*) FROM watched_channels) < ${MAX_WATCHED}
       OR EXISTS (SELECT 1 FROM watched_channels WHERE key = ${key})
    ON CONFLICT (key) DO UPDATE SET
      name = EXCLUDED.name,
      input = EXCLUDED.input,
      url = EXCLUDED.url
    RETURNING *
  `) as Row[];
  // No row means the `WHERE` was false: the deployment is watching its limit
  // already. Nothing was written, so there is nothing to undo.
  return rows[0] ? { ok: true, watched: toWatched(rows[0]) } : { ok: false, reason: "full" };
}

/** Stop watching. Returns whether there was anything there to stop watching. */
export async function unwatch(key: string): Promise<boolean> {
  await ready();
  const rows = (await db()`
    DELETE FROM watched_channels WHERE key = ${key} RETURNING key
  `) as { key: string }[];
  return rows.length > 0;
}

/**
 * Note that these channels were seen on air just now.
 *
 * Only for the panel to render — nothing branches on it. It exists because
 * "added, and never once seen live" and "added, and live yesterday" look
 * identical in a list that only carries a name, and an operator staring at a
 * channel that never appears needs to be able to tell a wrong handle from a
 * quiet one.
 */
export async function noteLive(keys: string[], now: number): Promise<void> {
  if (keys.length === 0) return;
  await ready();
  await db()`
    UPDATE watched_channels SET last_live_at = ${now}::bigint WHERE key = ANY(${keys})
  `;
}
