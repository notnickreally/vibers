import { NextResponse } from "next/server";
import { revoke, sameOrigin } from "@/lib/admin/guard";

/**
 * Sign out. Both cookies go — the session and any half-finished stage.
 *
 * No authorization check, deliberately: refusing to sign someone out because
 * they are not signed in is a worse outcome than doing it twice. It is still a
 * `POST` behind an origin check, so a link on another site cannot end your
 * session as a prank.
 */

export const revalidate = 0;

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Refused: cross-site request." }, { status: 403 });
  }
  return revoke(NextResponse.json({ ok: true }));
}
