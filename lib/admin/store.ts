/**
 * The admins table, server-side. Every read and write of it lives here.
 *
 * Two of the statements in this file are written the way they are because of
 * how Neon's HTTP driver works, and both would be subtly wrong the obvious way.
 *
 * **The cap is enforced inside the `INSERT`.** There is no session to hold a
 * transaction across two requests, so `SELECT count(*)` followed by an `INSERT`
 * has a gap in the middle that two simultaneous signups will both walk through
 * — and a deployment that is supposed to cap at eight admins ends up with nine.
 * `INSERT ... SELECT ... WHERE (SELECT count(*) ...) < MAX` has no gap, because
 * there is nothing between the count and the write. Zero rows back means full.
 *
 * **The failure counter is one `UPDATE ... RETURNING`.** Same reason. Reading
 * `failed_attempts` into JavaScript, adding one, and writing it back loses
 * every attempt that raced it, which is the one thing a brute-force counter
 * must not do. The new count and the new lock expiry are both computed in SQL
 * from the stored values, so N concurrent wrong guesses record N failures.
 *
 * The lockout itself is what makes the two puzzle layers worth anything. 1728
 * dial combinations falls in an afternoon at unlimited speed; at three free
 * guesses and then doubling delays it does not fall at all.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { db, ready } from "../db";
import { MAX_ADMINS } from "./config";

/** Guesses allowed before the delays start. Enough for a genuine fumble. */
const FREE_ATTEMPTS = 3;

/** The first lockout, doubling from there. */
const BASE_LOCK_MS = 15_000;

/** The longest lockout. Fifteen minutes is a wall, not a lifetime ban. */
const MAX_LOCK_MS = 15 * 60 * 1000;

/**
 * How far the doubling may run. `POWER(2, n)` with an unbounded `n` overflows a
 * bigint somewhere past sixty failures, and a determined guesser will get there
 * — so the exponent is clamped in SQL rather than trusted to stay small.
 */
const MAX_EXPONENT = 20;

export interface Admin {
  id: string;
  handle: string;
  passphrase: string;
  patchbay: string;
  dial: string;
  createdAt: number;
  failedAttempts: number;
  lockedUntil: number;
}

interface Row {
  id: string;
  handle: string;
  passphrase: string;
  patchbay: string;
  dial: string;
  created_at: string | number;
  failed_attempts: number;
  locked_until: string | number;
}

function toAdmin(row: Row): Admin {
  return {
    id: row.id,
    handle: row.handle,
    passphrase: row.passphrase,
    patchbay: row.patchbay,
    dial: row.dial,
    createdAt: Number(row.created_at),
    failedAttempts: row.failed_attempts,
    // BIGINT arrives as a string over the HTTP driver, and comparing a string
    // against a timestamp with `>` would be a string comparison.
    lockedUntil: Number(row.locked_until),
  };
}

export async function findByHandle(handle: string): Promise<Admin | undefined> {
  await ready();
  const rows = (await db()`SELECT * FROM admins WHERE handle = ${handle}`) as Row[];
  return rows[0] ? toAdmin(rows[0]) : undefined;
}

export async function findById(id: string): Promise<Admin | undefined> {
  await ready();
  const rows = (await db()`SELECT * FROM admins WHERE id = ${id}`) as Row[];
  return rows[0] ? toAdmin(rows[0]) : undefined;
}

export type SignupResult = { ok: true; id: string } | { ok: false; reason: "taken" | "full" };

/**
 * Create an admin, if there is room and the handle is free.
 *
 * The caller has already hashed all three credentials — this file never sees a
 * plaintext secret, which keeps the set of places that could log one down to
 * the routes that must.
 */
export async function create(admin: {
  handle: string;
  passphrase: string;
  patchbay: string;
  dial: string;
  now: number;
}): Promise<SignupResult> {
  await ready();
  const id = randomUUID();
  try {
    const rows = (await db()`
      INSERT INTO admins (id, handle, passphrase, patchbay, dial, created_at)
      SELECT ${id}, ${admin.handle}, ${admin.passphrase}, ${admin.patchbay}, ${admin.dial},
             ${admin.now}::bigint
      WHERE (SELECT count(*) FROM admins) < ${MAX_ADMINS}
      RETURNING id
    `) as { id: string }[];
    // No row means the `WHERE` was false: the deployment is full. The insert
    // never happened, so there is nothing to undo.
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, reason: "full" };
  } catch (err) {
    // 23505 is Postgres' unique violation — the handle is already someone's.
    if ((err as { code?: string })?.code === "23505") return { ok: false, reason: "taken" };
    throw err;
  }
}

/** Is this admin locked out right now, and until when? */
export function lockedUntil(admin: Admin, now: number): number | null {
  return admin.lockedUntil > now ? admin.lockedUntil : null;
}

/**
 * Record a wrong answer at any layer, and return when they may try again.
 *
 * One statement, so concurrent attempts each count. The clamp on the exponent
 * is not decoration — `POWER(2, failed_attempts)` grows past what a bigint
 * holds long before a determined guesser gets bored.
 */
export async function noteFailure(id: string, now: number): Promise<number | null> {
  await ready();
  const rows = (await db()`
    UPDATE admins
    SET failed_attempts = failed_attempts + 1,
        locked_until = CASE
          WHEN failed_attempts + 1 > ${FREE_ATTEMPTS}
          THEN ${now}::bigint + LEAST(
            ${MAX_LOCK_MS}::bigint,
            (${BASE_LOCK_MS}::bigint * POWER(
              2,
              LEAST(failed_attempts + 1 - ${FREE_ATTEMPTS} - 1, ${MAX_EXPONENT})
            )::bigint)
          )
          ELSE locked_until
        END
    WHERE id = ${id}
    RETURNING failed_attempts, locked_until
  `) as { failed_attempts: number; locked_until: string | number }[];

  if (!rows[0]) return null;
  const until = Number(rows[0].locked_until);
  return until > now ? until : null;
}

/** A completed sign-in clears the record. Only the third layer calls this. */
export async function noteSuccess(id: string, now: number): Promise<void> {
  await ready();
  await db()`
    UPDATE admins
    SET failed_attempts = 0, locked_until = 0, last_seen_at = ${now}::bigint
    WHERE id = ${id}
  `;
}

/** Who has an account, for the panel's roster. Handles and dates, never digests. */
export async function roster(): Promise<{ handle: string; createdAt: number }[]> {
  await ready();
  const rows = (await db()`
    SELECT handle, created_at FROM admins ORDER BY created_at ASC
  `) as { handle: string; created_at: string | number }[];
  return rows.map((r) => ({ handle: r.handle, createdAt: Number(r.created_at) }));
}

/** How many seats are left, for the signup page to say so before you fill a form in. */
export async function seatsLeft(): Promise<number> {
  await ready();
  const rows = (await db()`SELECT count(*)::int AS n FROM admins`) as { n: number }[];
  return Math.max(0, MAX_ADMINS - (rows[0]?.n ?? 0));
}
