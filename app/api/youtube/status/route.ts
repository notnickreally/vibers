import { NextResponse } from "next/server";
import { parseIds } from "@/lib/youtube";

/**
 * Is it still on air? — for the whole wall at once.
 *
 * `/api/youtube` resolves one video completely, including the oEmbed leg that
 * makes the app work with no key at all. This route answers the one question
 * that goes stale: a stream's title and channel are the same tomorrow, but
 * whether it is live right now is only true for as long as it is true. So this
 * is the Data API leg alone, batched.
 *
 * Batched because it has to be. `videos.list` takes up to 50 ids per call and
 * costs one unit whether you ask about one video or fifty, so refreshing a
 * sixty-tile wall is two units rather than sixty. Against a default allowance
 * of ten thousand a day, that is free.
 *
 * Without a key this answers `{}` rather than an error. A wall that cannot
 * refresh should keep what it already knows, not lose it.
 */

export const revalidate = 0;

interface Status {
  isLive: boolean;
  viewers?: number;
  endedAt?: string;
}

export async function GET(request: Request) {
  // `parseIds` is the security boundary: these ids are interpolated into a URL
  // we hand to Google, so anything that isn't recognisably a video id is
  // dropped rather than escaped, duplicates collapse, and the count is capped.
  const ids = parseIds(new URL(request.url).searchParams.get("ids"));
  if (ids.length === 0) return NextResponse.json({ statuses: {} });

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return NextResponse.json({ statuses: {} });

  const url =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,liveStreamingDetails&id=${ids.join(",")}&key=${key}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ statuses: {} });

    const data = (await res.json()) as {
      items?: {
        id?: string;
        snippet?: { liveBroadcastContent?: string };
        liveStreamingDetails?: { concurrentViewers?: string; actualEndTime?: string };
      }[];
    };

    const statuses: Record<string, Status> = {};
    for (const item of data.items ?? []) {
      if (!item.id) continue;
      const endedAt = item.liveStreamingDetails?.actualEndTime;
      const isLive = item.snippet?.liveBroadcastContent === "live" && !endedAt;
      const viewers = item.liveStreamingDetails?.concurrentViewers;
      statuses[item.id] = {
        isLive,
        viewers: isLive && viewers ? Number(viewers) : undefined,
        endedAt,
      };
    }

    // Ids that came back with nothing — deleted, privated, never real — are
    // simply absent here, and the caller leaves those tiles alone. Reporting
    // them as not-live would move a stream we know nothing about.
    return NextResponse.json({ statuses });
  } catch {
    // Same discipline as `enrich`: a refresh that fails is not an error the
    // wall should see. It just doesn't refresh.
    return NextResponse.json({ statuses: {} });
  }
}
