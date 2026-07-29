/**
 * What the admin panel needs from the environment, and what it does without it.
 *
 * Two secrets, and neither has a fallback. `ADMIN_SIGNUP_PASSWORD` is the thing
 * that makes signing up privileged; `ADMIN_SESSION_SECRET` is the thing that
 * makes a cookie unforgeable. A default for either would be a published
 * credential — the kind that ships to production because it worked locally —
 * so an unset variable is a 503 and the panel simply does not open.
 *
 * That is the same shape as `lib/db.ts`' `DatabaseUnconfigured`: the failure is
 * loud, it is specific, and nothing degrades into a version of itself that
 * happens to let everyone in.
 */

/** How many admins a deployment may ever have. Small on purpose. */
export const MAX_ADMINS = 8;

/**
 * The shortest session secret worth having. A 32-character secret is 256 bits
 * if it was generated rather than typed, and typing one is the mistake this
 * number exists to catch.
 */
const MIN_SECRET_LENGTH = 32;

export class AdminUnconfigured extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminUnconfigured";
  }
}

/** The key that signs every admin cookie. Throws rather than inventing one. */
export function sessionSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new AdminUnconfigured(
      `ADMIN_SESSION_SECRET is not set, or is shorter than ${MIN_SECRET_LENGTH} characters. The admin panel will not open without it.`,
    );
  }
  return secret;
}

/** The password that gates signing up. Throws rather than letting anyone in. */
export function signupPassword(): string {
  const password = process.env.ADMIN_SIGNUP_PASSWORD;
  if (!password) {
    throw new AdminUnconfigured(
      "ADMIN_SIGNUP_PASSWORD is not set. Signing up is closed until it is.",
    );
  }
  return password;
}

/**
 * Which variables this deployment has, as booleans.
 *
 * The panel renders this so an operator can tell a missing key from a broken
 * one without opening the Vercel dashboard. Values are never read here and
 * never leave the server — the answer is `set` or `not set`, and that is the
 * whole of it.
 */
export function environmentReadout(): { name: string; set: boolean; why: string }[] {
  const has = (name: string) => Boolean(process.env[name]);
  return [
    { name: "DATABASE_URL", set: has("DATABASE_URL"), why: "The shared wall lives here." },
    {
      name: "ADMIN_SESSION_SECRET",
      set: has("ADMIN_SESSION_SECRET"),
      why: "Signs the cookies that got you this far.",
    },
    {
      name: "ADMIN_SIGNUP_PASSWORD",
      set: has("ADMIN_SIGNUP_PASSWORD"),
      why: "Gates signing up. Unset closes the door.",
    },
    {
      name: "YOUTUBE_API_KEY",
      set: has("YOUTUBE_API_KEY"),
      why: "Liveness refresh, keyword sourcing, watched YouTube channels.",
    },
    {
      name: "YOUTUBE_DISCOVER_ENABLED",
      set: has("YOUTUBE_DISCOVER_ENABLED"),
      why: "Whether sourcing runs at all.",
    },
    {
      name: "TWITCH_CLIENT_ID",
      set: has("TWITCH_CLIENT_ID"),
      why: "Twitch liveness. Links work without it.",
    },
    {
      name: "TWITCH_CLIENT_SECRET",
      set: has("TWITCH_CLIENT_SECRET"),
      why: "The other half of the Twitch credential.",
    },
  ];
}
