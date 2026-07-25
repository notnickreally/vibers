import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center px-4 py-20 sm:px-6">
      <p className="eyebrow text-tally">Off air</p>
      <h1 className="mt-4 font-display text-4xl leading-tight font-extrabold tracking-[-0.03em] text-bone">
        There is no stream here.
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-muted">
        Either this page never existed, or the link points at something vibers.tv doesn&apos;t
        carry. Any YouTube URL can go up on the wall — paste it there and it plays.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/"
          className="bg-amber px-4 py-2 font-mono text-xs font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
        >
          Back to the wall
        </Link>
      </div>
    </div>
  );
}
