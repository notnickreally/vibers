import type { Metadata } from "next";
import Link from "next/link";
import { RelayComposer } from "@/components/stream/relay-composer";
import { SectionHead } from "@/components/ui/bits";

export const metadata: Metadata = {
  title: "Relay a stream",
  description:
    "Put someone else's live coding stream on the network. The URL is the only thing required.",
};

export default async function RelayPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
      <SectionHead
        slate="Relay"
        title={edit ? "Edit a relay" : "Relay a stream"}
        meta="A URL is enough"
      />

      <div className="mb-10 max-w-2xl space-y-3">
        <p className="text-[15px] leading-relaxed text-muted">
          A relay carries someone else&apos;s YouTube stream onto the network. It is not a
          run: there is no declared goal, no Prompt-Cam and no viewer count, because those
          would be things the creator never said.
        </p>
        <p className="text-[15px] leading-relaxed text-muted">
          Streaming your own work instead?{" "}
          <Link href="/go-live" className="text-amber underline-offset-4 hover:underline">
            Start a run
          </Link>{" "}
          — that&apos;s where goals, prompts and the Wire live.
        </p>
      </div>

      <RelayComposer editId={edit} />
    </div>
  );
}
