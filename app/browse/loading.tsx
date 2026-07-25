import { RunGridSkeleton } from "@/components/states";
import { SectionHead } from "@/components/ui/bits";

/** Route-level loading UI, so a slow navigation shows the same skeleton grid. */
export default function BrowseLoading() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
      <SectionHead slate="Browse" title="Live runs" meta="Connecting to the wire…" />
      <div className="mb-8 space-y-3">
        {["Stack", "Tool", "Sort"].map((row) => (
          <div key={row} className="flex flex-wrap items-center gap-2">
            <span className="w-12 shrink-0 font-mono text-[10px] tracking-[0.16em] text-faint uppercase">
              {row}
            </span>
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="shimmer h-[26px] w-16" />
            ))}
          </div>
        ))}
      </div>
      <RunGridSkeleton />
    </div>
  );
}
