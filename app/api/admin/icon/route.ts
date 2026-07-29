import { NextResponse } from "next/server";
import { body, failed } from "@/app/api/admin/failure";
import { currentAdmin, sameOrigin } from "@/lib/admin/guard";
import { ICON_REFUSAL, parseIconUpload } from "@/lib/icon";
import { clearIcon, iconSummary, putIcon } from "@/lib/site-icon";

/**
 * The site's favicon, managed.
 *
 * - `GET` — what is up: format, size, when it changed and who changed it.
 * - `PUT { dataUrl }` — put this image up, for everyone.
 * - `DELETE` — go back to the icon this repo ships with.
 *
 * The body carries a `data:` URL and nothing else — no filename, no declared
 * size, no dimensions. Everything about the image is established here from its
 * own bytes by `parseIconUpload`, for the same reason the watchlist establishes
 * a channel's name by asking the platform: a value accepted from a caller ends
 * up on everybody's screen, and this one ends up in everybody's tab.
 *
 * Every handler calls `currentAdmin` for itself. The panel being on screen
 * proves nothing here — `curl` never opens one.
 */

export const revalidate = 0;

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Not signed in." }, { status: 401 });
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Refused: cross-site request." }, { status: 403 });
}

export async function GET() {
  try {
    if (!(await currentAdmin(Date.now()))) return unauthorized();
    return NextResponse.json({ icon: await iconSummary() });
  } catch (err) {
    return failed(err);
  }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  try {
    const admin = await currentAdmin(Date.now());
    if (!admin) return unauthorized();

    const parsed = await body(request);
    const upload = parseIconUpload(parsed?.dataUrl);
    if (!upload.ok) {
      return NextResponse.json({ error: ICON_REFUSAL[upload.reason] }, { status: 400 });
    }

    const icon = await putIcon({
      icon: upload.icon,
      updatedBy: admin.handle,
      now: Date.now(),
    });
    return NextResponse.json({ icon });
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return forbidden();
  try {
    if (!(await currentAdmin(Date.now()))) return unauthorized();
    await clearIcon();
    return NextResponse.json({ icon: null });
  } catch (err) {
    return failed(err);
  }
}
