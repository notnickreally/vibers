import { NextResponse } from "next/server";
import { LookupError, lookupVideo } from "@/lib/lookup";
import { parseYouTube } from "@/lib/youtube";

/**
 * Look up a video's real metadata.
 *
 * The two-source lookup — oEmbed for what works without a key, the Data API
 * for liveness and viewers when there is one — lives in `lib/lookup`, shared
 * with `app/api/streams` so a stream going up on the shared wall is described
 * by YouTube rather than by whoever posted it.
 */

export const revalidate = 0;

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("v");
  if (!input) {
    return NextResponse.json({ error: "Pass a YouTube URL or id as ?v=" }, { status: 400 });
  }

  const source = parseYouTube(input);
  if (!source) {
    return NextResponse.json({ error: "That isn't a YouTube link." }, { status: 400 });
  }

  try {
    return NextResponse.json(await lookupVideo(source.id));
  } catch (err) {
    const fail = err instanceof LookupError ? err : null;
    return NextResponse.json(
      { error: fail?.message ?? "Couldn't reach YouTube. Check the connection and try again." },
      { status: fail?.status ?? 502 },
    );
  }
}
