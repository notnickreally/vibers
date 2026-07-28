import { NextResponse } from "next/server";
import { DatabaseUnconfigured } from "@/lib/db";

/**
 * What the wall's routes say when the database won't answer.
 *
 * A 503 and a sentence, never a fallback. The whole point of the wall living
 * in Neon is that everyone sees the same one, so a route that quietly served
 * an empty or per-instance wall on a connection failure would be showing
 * someone a wall that isn't the wall — and doing it silently, which is worse
 * than the error. The browser renders this text.
 */
export function failed(err: unknown): NextResponse {
  const missing = err instanceof DatabaseUnconfigured;
  console.error("[wall]", err);
  return NextResponse.json(
    {
      error: missing
        ? "The wall's database isn't configured here. DATABASE_URL is missing."
        : "Couldn't reach the wall's database. Nothing was changed.",
    },
    { status: 503 },
  );
}
