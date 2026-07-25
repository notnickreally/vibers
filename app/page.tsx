import type { Metadata } from "next";
import { MonitorWall } from "@/components/wall/monitor-wall";
import { SectionHead } from "@/components/ui/bits";

export const metadata: Metadata = {
  title: "vibers.tv — a wall of live coding streams",
  description:
    "Put YouTube live coding streams on a wall, watch them side by side, and open the one you want.",
};

export default function HomePage() {
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">
      <SectionHead
        slate="The wall"
        title="Live now"
        meta="Your streams, kept in this browser"
      />
      <MonitorWall />
    </div>
  );
}
