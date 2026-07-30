import type { Metadata } from "next";
import { ChannelList } from "@/components/channels/channel-list";
import { SectionHead } from "@/components/ui/bits";
import { currentAdmin } from "@/lib/admin/guard";
import { DatabaseUnconfigured } from "@/lib/db";
import { MAX_WATCHED, type Watched } from "@/lib/watch";
import { listWatched } from "@/lib/watchlist";

/**
 * The channels page. Public, and its own route.
 *
 * The watchlist was a section of `/admin`, which made it invisible to everyone
 * the wall belongs to. It is a page now, linked from the top nav beside the wall
 * itself: the list of channels the wall keeps an eye on is public information
 * about a public wall, and adding to it is a public act.
 *
 * Two things are decided on the server here, and only one of them is a control.
 * The list is rendered server-side so it is on screen before any JavaScript
 * runs. `isAdmin` decides whether the un-watch buttons are *drawn* — the route
 * checks the cookie for itself on every `DELETE`, because a page cannot vouch
 * for a route `curl` can reach without one.
 */

export const metadata: Metadata = {
  title: "Channels",
  description:
    "The YouTube and Twitch channels vibers.tv watches. Name one and the wall puts its stream up every time it goes on air.",
};

export const dynamic = "force-dynamic";

/**
 * Whether the visitor holds a session — for drawing, never for deciding.
 *
 * Swallows everything: a deployment with no admin configuration, or none
 * reachable, is a page with no un-watch buttons rather than a page that failed.
 * Adding does not need any of it.
 */
async function signedIn(): Promise<boolean> {
  try {
    return (await currentAdmin(Date.now())) !== null;
  } catch {
    return false;
  }
}

export default async function ChannelsPage() {
  let watchlist: Watched[] = [];
  let unreachable: string | null = null;
  try {
    watchlist = await listWatched();
  } catch (err) {
    // A message, never a fallback — the same stance the wall takes. An empty
    // list where a full one should be is a lie that looks exactly like the truth.
    console.error("[channels]", err);
    unreachable =
      err instanceof DatabaseUnconfigured
        ? "The channel list's database isn't configured here. DATABASE_URL is missing."
        : "Couldn't reach the channel list's database. Nothing here is the list.";
  }

  const isAdmin = await signedIn();

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
      <SectionHead
        slate="Channels"
        title="Channels the wall watches"
        meta={
          unreachable
            ? undefined
            : `${watchlist.length} of ${MAX_WATCHED} watched · anyone can add one`
        }
      />

      {unreachable ? (
        <div className="border border-del/40 bg-del/6 p-6">
          <p className="font-mono text-[10px] tracking-[0.16em] text-del uppercase">Unavailable</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{unreachable}</p>
        </div>
      ) : (
        <ChannelList initial={watchlist} isAdmin={isAdmin} />
      )}
    </div>
  );
}
