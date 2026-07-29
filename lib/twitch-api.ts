/**
 * Twitch's Helix API — the optional half of the Twitch integration.
 *
 * The wall works without any of this. A pasted Twitch link parses, frames and
 * plays with no credentials at all, and the channel's real name and images come
 * out of Twitch's own OpenGraph tags (see `lib/twitch-lookup.ts`). What Helix
 * adds is the one thing a public page cannot honestly tell us: **whether the
 * channel is on air right now, and how many people are watching.** That is what
 * the Live/Ended shelves, the tally lamp and the viewer count read, so with no
 * credentials a Twitch stream stays in the `isLive: undefined` tri-state the
 * wall already knows how to draw — unconfirmed, not asserted.
 *
 * Same bargain YouTube makes here: `YOUTUBE_API_KEY` is optional and buys
 * liveness and viewers; `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` are optional
 * and buy the same. The difference is only in the handshake — Twitch has no
 * bare-key mode, so an app token has to be minted first and kept.
 *
 * The token is an **app** token (client credentials): it acts as the
 * application, never as a viewer, and it reads only public data. Nobody signs
 * in to vibers.tv, so there is no user token to hold and no scope to ask for.
 */

import "server-only";

const HELIX = "https://api.twitch.tv/helix";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";

/**
 * `user_login` takes up to 100 per call — Twitch's own limit, and the reason
 * refreshing a sixty-tile wall costs one request rather than sixty.
 */
export const MAX_LOGINS = 100;

export interface TwitchCredentials {
  clientId: string;
  clientSecret: string;
}

/** Configured, or not. Everything below is a no-op when this returns null. */
export function credentials(): TwitchCredentials | null {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

interface Token {
  value: string;
  /** Epoch ms. Minted with a minute of slack so it is never used at the edge. */
  expiresAt: number;
}

let token: Token | null = null;
let minting: Promise<Token | null> | null = null;

/** A minute of headroom, so a token never expires between the check and the call. */
const SLACK_MS = 60_000;

async function mint(creds: TwitchCredentials, now: number): Promise<Token | null> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: "client_credentials",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  // App tokens last about 60 days; the expiry is honoured rather than assumed.
  const ttl = (data.expires_in ?? 3600) * 1000;
  return { value: data.access_token, expiresAt: now + Math.max(ttl - SLACK_MS, SLACK_MS) };
}

/**
 * The app token, minted on first use and kept.
 *
 * The in-flight promise is shared so a cold instance answering ten requests at
 * once mints one token rather than ten — Twitch would honour all ten and
 * invalidate the earlier ones, which is how a fleet ends up authenticating in a
 * loop against itself.
 */
async function accessToken(creds: TwitchCredentials, now: number): Promise<string | null> {
  if (token && token.expiresAt > now) return token.value;
  if (!minting) {
    minting = mint(creds, now).finally(() => {
      minting = null;
    });
  }
  token = await minting;
  return token?.value ?? null;
}

/** Throw the cached token away — what a 401 means, and the only thing it means. */
function forget(): void {
  token = null;
}

/**
 * One Helix GET, authenticated. Returns null on anything that isn't a 200.
 *
 * Nothing here throws. Every caller is an enrichment on top of a lookup that
 * already succeeded without credentials, so a Twitch outage, a revoked secret
 * or a spent rate limit must degrade to "we don't know" — never to a wall that
 * won't load.
 */
export async function helix<T>(path: string, params: URLSearchParams): Promise<T | null> {
  const creds = credentials();
  if (!creds) return null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const bearer = await accessToken(creds, Date.now());
    if (!bearer) return null;
    try {
      const res = await fetch(`${HELIX}/${path}?${params}`, {
        headers: { "client-id": creds.clientId, authorization: `Bearer ${bearer}` },
        cache: "no-store",
      });
      // The one recoverable failure: a token that was fine when it was cached
      // and isn't now. Everything else is answered with what we already know.
      if (res.status === 401) {
        forget();
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
  return null;
}

/** A `/helix/streams` entry, as much of it as the wall reads. */
export interface HelixStream {
  user_login?: string;
  user_name?: string;
  game_name?: string;
  title?: string;
  viewer_count?: number;
  started_at?: string;
  thumbnail_url?: string;
}

export interface HelixUser {
  login?: string;
  display_name?: string;
  description?: string;
  profile_image_url?: string;
  offline_image_url?: string;
}

export interface HelixVideo {
  id?: string;
  user_name?: string;
  user_login?: string;
  title?: string;
  description?: string;
  created_at?: string;
  thumbnail_url?: string;
  view_count?: number;
}

export interface HelixClip {
  id?: string;
  broadcaster_name?: string;
  title?: string;
  thumbnail_url?: string;
  created_at?: string;
  view_count?: number;
}

/**
 * Which of these logins are live, keyed by **lowercased login** — or null.
 *
 * A login missing from the answer is offline: that is Helix's contract, and
 * unlike YouTube's `videos.list` it is a real signal rather than an absence to
 * be careful about, because `/streams` returns a row per *live* channel and
 * says nothing about the rest. So the caller may read a missing login as off
 * air, which is exactly what it cannot do on the YouTube side.
 *
 * Which is why **failure has to be a different value from "nobody is live"**.
 * No credentials, a spent rate limit or a Twitch outage all produce an empty
 * answer, and reading that as "everyone is off air" would sweep a wall of live
 * Twitch tiles onto the Ended shelf on one bad request. An empty map means
 * nobody; a null means we were told nothing.
 */
export async function liveStreams(logins: string[]): Promise<Map<string, HelixStream> | null> {
  const found = new Map<string, HelixStream>();
  if (logins.length === 0) return found;

  for (let i = 0; i < logins.length; i += MAX_LOGINS) {
    const params = new URLSearchParams();
    for (const login of logins.slice(i, i + MAX_LOGINS)) params.append("user_login", login);
    params.set("first", String(MAX_LOGINS));
    const data = await helix<{ data?: HelixStream[] }>("streams", params);
    if (!data) return null;
    for (const entry of data.data ?? []) {
      if (entry.user_login) found.set(entry.user_login.toLowerCase(), entry);
    }
  }
  return found;
}

/**
 * Twitch's thumbnails are templates: `…-{width}x{height}.jpg`.
 *
 * Handing one out unfilled puts a literal `{width}` in an `img src`, which
 * 404s. 16:9 at 640 is the size the wall's tiles and the watch page's poster
 * both want.
 */
export function sizeThumbnail(url: string | undefined, width = 640, height = 360): string | null {
  if (!url) return null;
  const filled = url.replace("{width}", String(width)).replace("{height}", String(height));
  // The VOD endpoint spells it `%{width}x%{height}`; the leading `%` is left
  // behind by the replacements above.
  return filled.replace(/%(\d)/g, "$1");
}
