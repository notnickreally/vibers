import type { Metadata } from "next";
import { ReportForm } from "@/components/report/report-form";
import { SectionHead } from "@/components/ui/bits";
import { RIGHTS_CONTACT } from "@/lib/stream";

export const metadata: Metadata = {
  title: "Report a stream",
  description:
    "Report a stream that shouldn't be on the wall, or a page that misrepresents you.",
};

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v } = await searchParams;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">
      <SectionHead slate="Rights" title="Report a stream" meta="Reviewed within one business day" />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="mb-8 max-w-2xl text-[15px] leading-relaxed text-muted">
            Streams on vibers.tv are YouTube videos played through YouTube&apos;s own
            player. If one of them is yours and you don&apos;t want it here, or a page
            misrepresents you, this form takes it down. No account, no long explanation.
          </p>
          <ReportForm videoId={v} />
        </div>

        <aside className="space-y-6">
          <div className="border border-edge-soft bg-panel p-4">
            <p className="eyebrow">How this works</p>
            <ol className="mt-3 space-y-3 text-[13px] leading-relaxed text-muted">
              <li>
                <span className="font-mono text-[11px] text-amber">01</span> The stream comes
                off the wall as soon as a report names it. We don&apos;t wait for a
                judgement call to do that.
              </li>
              <li>
                <span className="font-mono text-[11px] text-amber">02</span> A person reads
                the report within one business day and replies either way.
              </li>
              <li>
                <span className="font-mono text-[11px] text-amber">03</span> If it stands,
                the video stops being playable here and won&apos;t be addable again.
              </li>
            </ol>
          </div>

          <div className="border border-edge-soft bg-panel p-4">
            <p className="eyebrow">Worth knowing</p>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              vibers.tv never re-hosts video. It plays YouTube&apos;s embedded player, so
              the only copy lives on YouTube. If you want the video itself gone rather than
              just its page here, that request goes to YouTube.
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
