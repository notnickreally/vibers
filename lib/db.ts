/**
 * The database. Neon Postgres, over HTTP, shared by every visitor.
 *
 * The wall used to live in each browser's `localStorage`, which made "your
 * wall" literally true and "the wall" impossible: two people on the same site
 * saw two different walls, and a stream someone put up existed nowhere but on
 * their own machine. Everything the wall holds now lives here instead.
 *
 * Three things about this file are deliberate.
 *
 * **The client is built lazily.** `neon()` throws when `DATABASE_URL` is
 * unset, and Next evaluates module top-level code during `next build` — so a
 * top-level `const sql = neon(...)` turns a missing environment variable into
 * a failed build rather than a failed request. It is built on first use and
 * kept.
 *
 * **The schema is created on first use, not by a migration tool.** There is no
 * history to migrate; a `CREATE TABLE IF NOT EXISTS` behind a memoized promise
 * is the whole of it, costs one round trip per cold instance, and means a fresh
 * Neon branch (every preview deployment gets one) is usable without a deploy
 * step that could be skipped. Every table this app has is created here — a
 * second module with its own first-use migration would be a second answer to a
 * question this file already answers.
 *
 * **There is no fallback.** If the database is unreachable the routes fail and
 * the wall says so. Quietly serving an in-memory or per-browser wall instead
 * would reintroduce the exact bug this replaced, and it would do it invisibly.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | null = null;

export class DatabaseUnconfigured extends Error {
  constructor() {
    super("DATABASE_URL is not set. The wall needs its Neon database to hold anything.");
    this.name = "DatabaseUnconfigured";
  }
}

function connect(): NeonQueryFunction<false, false> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseUnconfigured();
  return neon(url);
}

/** The query function, built on first call. Server-only — never import from a client component. */
export function db(): NeonQueryFunction<false, false> {
  if (!client) client = connect();
  return client;
}

let schema: Promise<void> | null = null;

/**
 * Make sure the tables exist. Idempotent, and awaited once per instance.
 *
 * The promise is cleared on failure so a cold start that happened to land
 * during a Neon reconnect can try again, rather than caching the rejection and
 * failing every request for the life of the instance.
 */
export function ready(): Promise<void> {
  if (!schema) {
    schema = migrate().catch((err) => {
      schema = null;
      throw err;
    });
  }
  return schema;
}

async function migrate(): Promise<void> {
  const sql = db();
  await sql`
    CREATE TABLE IF NOT EXISTS streams (
      video_id    TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      channel     TEXT NOT NULL,
      channel_url TEXT,
      thumbnail   TEXT NOT NULL,
      description TEXT,
      is_live     BOOLEAN,
      viewers     INTEGER,
      ended_at    TEXT,
      added_at    BIGINT NOT NULL,
      sourced_at  BIGINT
    )
  `;
  // The wall is ordered newest-first and capped, so this is the index every
  // read and every trim uses.
  await sql`CREATE INDEX IF NOT EXISTS streams_added_at_idx ON streams (added_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS dismissed_streams (
      video_id     TEXT PRIMARY KEY,
      dismissed_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS dismissed_streams_at_idx ON dismissed_streams (dismissed_at DESC)
  `;
  // The people allowed to moderate the wall. Three credentials per admin,
  // hashed the same way, plus the two columns the lockout is computed from.
  // `handle` is UNIQUE so two spellings of the same operator cannot exist, and
  // so the lookup every sign-in starts with is an index hit.
  await sql`
    CREATE TABLE IF NOT EXISTS admins (
      id              TEXT PRIMARY KEY,
      handle          TEXT NOT NULL UNIQUE,
      passphrase      TEXT NOT NULL,
      patchbay        TEXT NOT NULL,
      dial            TEXT NOT NULL,
      created_at      BIGINT NOT NULL,
      last_seen_at    BIGINT,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until    BIGINT NOT NULL DEFAULT 0
    )
  `;
}
