import { NextResponse } from "next/server";
import { failed } from "@/app/api/streams/failure";
import { LookupError, lookupVideo } from "@/lib/lookup";
import * as wall from "@/lib/wall";
import { parseYouTube } from "@/lib/youtube";

/**
 * The wall itself — one shared wall, in Neon, for everybody.
 *
 * - `GET` — what is on it.
 * - `POST { v }` — put a stream up. **An id or a URL, and nothing else.** The
 *   title, channel and thumbnail are looked up here rather than accepted from
 *   the caller: this list is rendered to every visitor, so a client-supplied
 *   title would be arbitrary text and a client-supplied thumbnail an arbitrary
 *   `img src`, on everyone's wall, from anyone who can reach this route.
 * - `DELETE ?v=<id>` — take one off. `DELETE ?sourced=1` — take every
 *   auto-sourced one off.
 *
 * Every response is the whole wall, so a client never has to reconstruct it
 * from a delta it may have raced someone else on.
 */

export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json({ streams: await wall.listStreams() });
  } catch (err) {
    return failed(err);
  }
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = (await request.json()) as unknown;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const raw = (input as { v?: unknown })?.v;
  const source = typeof raw === "string" ? parseYouTube(raw) : null;
  if (!source) {
    return NextResponse.json({ error: "That isn't a YouTube link." }, { status: 400 });
  }

  let meta: Awaited<ReturnType<typeof lookupVideo>>;
  try {
    meta = await lookupVideo(source.id);
  } catch (err) {
    const fail = err instanceof LookupError ? err : null;
    return NextResponse.json(
      { error: fail?.message ?? "Couldn't reach YouTube. Check the connection and try again." },
      { status: fail?.status ?? 502 },
    );
  }

  try {
    // No `sourcedAt`: a stream someone chose is a manual one, and manual is
    // what keeps it out of the sweep's reach.
    return NextResponse.json({ streams: await wall.addStream(meta, Date.now()), added: meta });
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    if (params.get("sourced")) {
      return NextResponse.json({ streams: await wall.clearSourced(Date.now()) });
    }
    const source = parseYouTube(params.get("v") ?? "");
    if (!source) {
      return NextResponse.json({ error: "Pass a video id as ?v=" }, { status: 400 });
    }
    return NextResponse.json({ streams: await wall.removeStream(source.id, Date.now()) });
  } catch (err) {
    return failed(err);
  }
}
