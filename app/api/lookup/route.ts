import { NextResponse } from "next/server";
import { LookupError } from "@/lib/lookup";
import { lookupSource } from "@/lib/lookup-source";
import { parseKey, parseSource, PROVIDER_LABEL } from "@/lib/source";

/**
 * Look up what a link — or a stored key — actually is, on either platform.
 *
 * This is `/api/youtube` grown a second platform. That route stays exactly as
 * it was, YouTube-only, because it is a public URL somebody may be calling; this
 * one is what the app itself asks, and it takes anything `parseSource` accepts.
 *
 * It answers to two spellings on purpose. A **link** is what someone pastes; a
 * **key** is what the wall stored and what `/watch/<key>` carries, and the watch
 * page re-asks with it on every load so an open tab shows the stream's real
 * current title rather than whatever was true when it went up.
 */

export const revalidate = 0;

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("v");
  if (!input) {
    return NextResponse.json({ error: "Pass a YouTube or Twitch URL as ?v=" }, { status: 400 });
  }

  // A stored key first: `twitch:channel:someone` is not a URL anyone can paste,
  // so it would not survive `parseSource`, and it is what the watch page sends.
  const source = parseKey(input) ?? parseSource(input);
  if (!source) {
    return NextResponse.json({ error: "That isn't a YouTube or Twitch link." }, { status: 400 });
  }

  try {
    return NextResponse.json(await lookupSource(source));
  } catch (err) {
    const fail = err instanceof LookupError ? err : null;
    return NextResponse.json(
      {
        error:
          fail?.message ??
          `Couldn't reach ${PROVIDER_LABEL[source.provider]}. Check the connection and try again.`,
      },
      { status: fail?.status ?? 502 },
    );
  }
}
