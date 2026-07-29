import { NextResponse } from "next/server";
import { AdminUnconfigured } from "@/lib/admin/config";
import { DatabaseUnconfigured } from "@/lib/db";

/**
 * What the admin routes say when they cannot do their job.
 *
 * Two kinds of "not configured" reach here and both are 503s, because both mean
 * the same thing: this deployment cannot decide whether you are an admin, so it
 * will not guess. `AdminUnconfigured` names which variable is missing, which is
 * safe — the name of a secret is not the secret, and an operator staring at a
 * blank panel needs to know which one to set.
 *
 * Anything else is answered generically. The error is logged with a tag and
 * without the request body, so a stack trace from the middle of a sign-in
 * cannot put a passphrase in the platform's log drain.
 */
export function failed(err: unknown): NextResponse {
  if (err instanceof AdminUnconfigured) {
    console.error("[admin] not configured");
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
  if (err instanceof DatabaseUnconfigured) {
    console.error("[admin] no database");
    return NextResponse.json(
      { error: "The admin panel's database isn't configured here. DATABASE_URL is missing." },
      { status: 503 },
    );
  }
  console.error("[admin]", err instanceof Error ? err.message : "unknown error");
  return NextResponse.json({ error: "Something went wrong. Nothing was changed." }, { status: 500 });
}

/** The one thing a failed sign-in ever says, at every layer. */
export const REFUSED = "That didn't open.";

/** Read a JSON body without letting a malformed one become a 500. */
export async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
