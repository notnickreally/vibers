import type { Metadata } from "next";
import { MonitorWall } from "@/components/wall/monitor-wall";
import { SectionHead } from "@/components/ui/bits";
import { currentAdmin } from "@/lib/admin/guard";

export const metadata: Metadata = {
  title: "vibers.tv — a wall of live coding streams",
  description:
    "Put YouTube live coding streams on a wall, watch them side by side, and open the one you want.",
};

/**
 * The page reads the cookie, so the wall knows on its first paint whether to
 * draw the ✕ — the same reason `app/channels/page.tsx` is dynamic. Nothing else
 * here needs a request: the wall's own contents still arrive from `/api/streams`
 * in the browser, so what this costs is one cookie read per load, not a render
 * that waits on Neon.
 */
export const dynamic = "force-dynamic";

/**
 * Whether the visitor holds a session — for drawing, never for deciding.
 *
 * Swallows everything: a deployment with no admin configuration, or none
 * reachable, is a wall with no ✕ rather than a wall that failed. Everything
 * else on this page — adding, watching, opening — needs none of it.
 */
async function signedIn(): Promise<boolean> {
  try {
    return (await currentAdmin(Date.now())) !== null;
  } catch {
    return false;
  }
}

export default async function HomePage() {
  const isAdmin = await signedIn();

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">
      {/* Not "Live now" any more: the feed carries what has ended underneath
          what is on air, and half of what it holds is deliberately not live. */}
      <SectionHead
        slate="The wall"
        title="The wall"
        meta="One shared wall — everything anyone puts up"
      />
      <MonitorWall isAdmin={isAdmin} />
    </div>
  );
}
