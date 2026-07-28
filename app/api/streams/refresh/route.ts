import { NextResponse } from "next/server";
import { failed } from "@/app/api/streams/failure";
import { fetchStatuses } from "@/lib/statuses";
import * as wall from "@/lib/wall";

/**
 * Re-ask YouTube what is still on air, and write the answer back.
 *
 * Without this the wall never moves: `isLive` is stamped once when a stream is
 * added and then believed forever, so a stream that ends while it sits up
 * stays in the Live tab until someone takes it down and puts it back.
 *
 * On a shared wall this is strictly cheaper than it was per-browser: one
 * refresh serves every visitor instead of each of them spending their own
 * calls on the same sixty ids. It is batched fifty ids to a call — two units
 * at the very top end, against a daily allowance of ten thousand.
 */

export const revalidate = 0;

export async function POST() {
  try {
    const ids = (await wall.listStreams()).map((s) => s.videoId);
    return NextResponse.json({ streams: await wall.applyStatuses(await fetchStatuses(ids)) });
  } catch (err) {
    return failed(err);
  }
}
