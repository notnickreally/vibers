import type { Metadata } from "next";
import { ReportForm } from "@/components/stream/report-form";
import { SectionHead } from "@/components/ui/bits";
import { RIGHTS_CONTACT } from "@/lib/session";

export const metadata: Metadata = {
  title: "Report a feed",
  description:
    "Report a run that is playing your video without permission, or that misrepresents you.",
};

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; handle?: string; v?: string }>;
}) {
  const { run, handle, v } = await searchParams;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
      <SectionHead
        slate="Rights"
        title="Report a feed"
        meta="Reviewed within one business day"
      />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="mb-8 max-w-2xl text-[15px] leading-relaxed text-muted">
            A run&apos;s picture comes from a YouTube video its broadcaster attached. If
            that video is yours and you did not agree to it, or the run misrepresents you,
            this form takes it down. You do not need an account and you do not need to
            explain yourself at length.
          </p>
          <ReportForm run={run} handle={handle} videoId={v} />
        </div>

        <aside className="space-y-6">
          <div className="border border-edge-soft bg-panel p-4">
            <p className="eyebrow">How this works</p>
            <ol className="mt-3 space-y-3 text-[13px] leading-relaxed text-muted">
              <li>
                <span className="font-mono text-[11px] text-amber">01</span> The feed stops
                playing on vibers.tv as soon as the report names a run. We don&apos;t wait
                for a judgement call to do that.
              </li>
              <li>
                <span className="font-mono text-[11px] text-amber">02</span> A person reads
                the report within one business day and replies to you either way.
              </li>
              <li>
                <span className="font-mono text-[11px] text-amber">03</span> If it stands,
                the run keeps its prompt transcript and diff but loses the video, and the
                viber is told why.
              </li>
            </ol>
          </div>

          <div className="border border-edge-soft bg-panel p-4">
            <p className="eyebrow">Worth knowing</p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              vibers.tv never re-hosts video. It plays YouTube&apos;s own embedded player,
              unmodified, so the copy lives on YouTube. If you want the video itself gone
              rather than just this run, that request goes to YouTube.
            </p>
            <p className="mt-3 font-mono text-[11px] text-faint">
              Anything urgent: {RIGHTS_CONTACT}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
