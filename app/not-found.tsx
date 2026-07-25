import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center px-4 py-20 sm:px-6">
      <p className="eyebrow text-tally">Off air</p>
      <h1 className="mt-4 font-display text-4xl leading-tight font-extrabold tracking-[-0.03em] text-bone">
        There is no run here.
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-muted">
        Either the viber ended their run, or this page never existed. Ended runs keep their
        transcript on the viber&apos;s profile — start there if you know whose it was.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/browse"
          className="bg-amber px-4 py-2 font-mono text-xs font-semibold tracking-[0.12em] text-ink uppercase transition-colors hover:bg-bone"
        >
          Browse live runs
        </Link>
        <Link
          href="/"
          className="border border-edge px-4 py-2 font-mono text-xs tracking-[0.12em] text-bone uppercase transition-colors hover:border-teal hover:text-teal"
        >
          Back to the front page
        </Link>
      </div>
    </div>
  );
}
