import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Panel } from "@/components/admin/panel";
import { AdminUnconfigured, environmentReadout } from "@/lib/admin/config";
import { currentAdmin } from "@/lib/admin/guard";
import { roster } from "@/lib/admin/store";
import { DatabaseUnconfigured } from "@/lib/db";
import { iconSummary } from "@/lib/site-icon";
import * as wall from "@/lib/wall";
import { listWatched } from "@/lib/watchlist";

/**
 * The panel. Server-rendered behind the gate.
 *
 * The redirect below is a courtesy to whoever wandered here, not a security
 * control: `/api/admin/streams` checks the cookie for itself on every call,
 * because a page cannot vouch for a route that `curl` can reach without one.
 *
 * `noindex` because there is nothing here to index and a sign-in page in search
 * results is an invitation.
 */

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  let admin: Awaited<ReturnType<typeof currentAdmin>>;
  try {
    admin = await currentAdmin(Date.now());
  } catch (err) {
    // An unconfigured deployment cannot decide who is an admin, so it says so
    // rather than redirecting to a gate that would also fail.
    if (err instanceof AdminUnconfigured || err instanceof DatabaseUnconfigured) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
          <p className="eyebrow">Not configured</p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-bone">
            The panel can&apos;t open here
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">{err.message}</p>
          <ul className="mt-6 space-y-px border border-edge-soft bg-edge-soft">
            {environmentReadout().map((entry) => (
              <li key={entry.name} className="flex justify-between bg-ink p-3">
                <code className="font-mono text-[12px] text-bone">{entry.name}</code>
                <span
                  className={`font-mono text-[10px] tracking-[0.14em] uppercase ${
                    entry.set ? "text-teal" : "text-faint"
                  }`}
                >
                  {entry.set ? "set" : "not set"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    throw err;
  }

  if (!admin) redirect("/admin/login");

  const [streams, dismissed, admins, watchlist, icon] = await Promise.all([
    wall.listStreams(),
    wall.listDismissed(),
    roster(),
    listWatched(),
    iconSummary(),
  ]);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
      <Panel
        initial={{
          handle: admin.handle,
          streams,
          dismissed: dismissed.length,
          environment: environmentReadout(),
          admins,
          watched: watchlist.length,
          icon,
        }}
      />
    </div>
  );
}
