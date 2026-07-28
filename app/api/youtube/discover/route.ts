import { NextResponse } from "next/server";
import {
  CONFIRM_TTL,
  DISCOVER_TTL,
  type DiscoverResult,
  MAX_CANDIDATES,
  MAX_PER_KEYWORD,
  readCandidates,
  readConfirmed,
  readReason,
  resolveKeywords,
} from "@/lib/discover";
import { chunk, MAX_IDS, parseIds } from "@/lib/youtube";

/**
 * Go and find live coding streams, by keyword.
 *
 * Two legs, and the difference between them is the whole design:
 *
 * - **`search.list`** finds candidates. It is the expensive one — a hundred
 *   calls a day for the entire Google Cloud project, free and unbuyable — so it
 *   is cached for hours and shared by every visitor.
 * - **`videos.list`** confirms each candidate is actually on air. It is the
 *   cheap one — a unit per fifty videos out of ten thousand a day — so it is
 *   re-asked every minute and nothing reaches the wall without it. `eventType=live`
 *   is an index query with no freshness guarantee, and the `liveBroadcastContent`
 *   that comes back inside those results is self-confirming: it says "live"
 *   because "live" is what was asked for. The resource is the only thing that
 *   knows.
 *
 * The route takes **no input**. That is deliberate: a `?q=` here would let any
 * visitor spend a scarce site-wide resource that costs them nothing and cannot
 * be topped up. Keywords come from the deployment, or from the seeds.
 *
 * Off unless `YOUTUBE_DISCOVER_ENABLED` is set, because production, a preview
 * deployment and a laptop running `pnpm dev` all read the same key and spend
 * the same hundred while keeping three separate caches. Opting in per
 * environment is what stops a preview branch from quietly eating the day.
 */

export const revalidate = 0;

/**
 * The floor under the cache.
 *
 * `next: { revalidate }` gives one upstream call per keyword per TTL across all
 * visitors — but that is a property of a managed, single-region Data Cache, not
 * of Next itself. On a host that scales to zero with an ephemeral filesystem,
 * every cold start would pay for a fresh round of searches. This memo is the
 * guard that does not depend on where we are deployed: with it, an instance can
 * overspend by the number of live instances, rather than by the number of
 * requests it serves.
 */
let memo: { at: number; result: DiscoverResult } | null = null;

/**
 * Set when the search bucket is spent. It does not refill until midnight
 * Pacific, so retrying before then is pure noise — and the *other* bucket, the
 * one `videos.list` draws on, is untouched and still working, which is why a
 * spent search quota degrades to "found nothing new" instead of taking the
 * wall's liveness down with it.
 */
let quotaUntil = 0;

function msUntilQuotaReset(now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(now));
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // `hour12: false` reports midnight as 24 rather than 0 in some ICU builds.
  const hour = at("hour") % 24;
  return 86_400_000 - (hour * 3600 + at("minute") * 60 + at("second")) * 1000;
}

async function search(keyword: string, key: string): Promise<{ ids: string[]; quota: boolean }> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    eventType: "live",
    q: keyword,
    order: "viewCount",
    maxResults: String(MAX_PER_KEYWORD),
    // The wall can only play what YouTube will let us embed and syndicate, so
    // anything else is a tile that would never come up.
    videoEmbeddable: "true",
    videoSyndicated: "true",
    // Filtered, because this is the one surface where video nobody chose
    // autoplays on arrival — but `moderate`, not `strict`. Measured against the
    // live API on 2026-07-28: `strict` returns **zero** results for "live
    // coding" where `moderate` returns a full page of them, and the same holds
    // across the seed keywords. Whatever `strict` demands, a livestream
    // essentially never carries it, so it does not read as a stricter filter
    // here — it reads as the feature being switched off. `moderate` is
    // YouTube's own default and is still a filter.
    safeSearch: "moderate",
    relevanceLanguage: "en",
    key,
  });

  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
      next: { revalidate: DISCOVER_TTL },
    });
    const json = await res.json();
    const reason = readReason(res.status, json);
    if (reason) return { ids: [], quota: reason === "quota" };
    return { ids: readCandidates(json), quota: false };
  } catch {
    return { ids: [], quota: false };
  }
}

async function confirm(ids: string[], key: string): Promise<DiscoverResult["streams"]> {
  const streams: DiscoverResult["streams"] = [];
  for (const batch of chunk(ids, MAX_IDS)) {
    const params = new URLSearchParams({
      part: "snippet,liveStreamingDetails",
      id: batch.join(","),
      key,
    });
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
        next: { revalidate: CONFIRM_TTL },
      });
      if (!res.ok) continue;
      streams.push(...readConfirmed(await res.json()));
    } catch {
      // One batch failing is fewer streams, not no streams.
    }
  }
  return streams;
}

export async function GET() {
  // Same discipline as the status route: everything below answers 200 with an
  // empty result and a reason. A wall that cannot discover should keep what it
  // already has and be told why, not be handed an error to render.
  if (!process.env.YOUTUBE_DISCOVER_ENABLED) {
    return NextResponse.json({ keywords: [], streams: [], reason: "off" } satisfies DiscoverResult);
  }

  const key = process.env.YOUTUBE_API_KEY;
  const keywords = resolveKeywords(process.env.YOUTUBE_DISCOVER_KEYWORDS);
  if (!key) {
    return NextResponse.json({ keywords, streams: [], reason: "no-key" } satisfies DiscoverResult);
  }

  const now = Date.now();
  if (memo && now - memo.at < DISCOVER_TTL * 1000) return NextResponse.json(memo.result);
  if (now < quotaUntil) {
    return NextResponse.json({ keywords, streams: [], reason: "quota" } satisfies DiscoverResult);
  }

  const candidates: string[] = [];
  let quota = false;
  for (const keyword of keywords) {
    const found = await search(keyword, key);
    if (found.quota) {
      quota = true;
      break;
    }
    candidates.push(...found.ids);
  }

  if (quota) {
    quotaUntil = now + msUntilQuotaReset(now);
    return NextResponse.json({ keywords, streams: [], reason: "quota" } satisfies DiscoverResult);
  }

  // The ids came off a response rather than out of our own hands, and the next
  // thing that happens to them is being interpolated into another Google URL —
  // so they go through the same gate a pasted id would. The cap is passed
  // explicitly: `parseIds` guards what we send, `chunk` sizes what we send it in.
  const ids = parseIds(candidates.join(","), MAX_CANDIDATES);
  const result: DiscoverResult = { keywords, streams: await confirm(ids, key) };
  memo = { at: now, result };
  return NextResponse.json(result);
}
