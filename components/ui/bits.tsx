import Link from "next/link";
import type { ReactNode } from "react";
import { POSTER_TONES } from "@/lib/format";

/** The tally lamp + word LIVE. Rendered only when a run is genuinely live. */
export function LiveBadge({ label = "LIVE" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 border border-tally/40 bg-tally/12 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.16em] text-tally">
      <span className="tally-lamp h-1.5 w-1.5 rounded-full bg-tally" />
      {label}
    </span>
  );
}

export function Tag({
  children,
  hue,
  href,
}: {
  children: ReactNode;
  hue?: number;
  href?: string;
}) {
  const style =
    hue === undefined
      ? undefined
      : {
          color: `hsl(${hue} 70% 72%)`,
          borderColor: `hsl(${hue} 40% 30%)`,
          background: `hsl(${hue} 40% 12%)`,
        };
  const cls =
    "inline-flex items-center border border-edge bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted transition-colors hover:text-bone";
  return href ? (
    <Link href={href} className={cls} style={style}>
      {children}
    </Link>
  ) : (
    <span className={cls} style={style}>
      {children}
    </span>
  );
}

/**
 * Section heading. The eyebrow is a broadcast slate, the count is real
 * information — never a decorative 01 / 02 / 03.
 */
export function SectionHead({
  slate,
  title,
  meta,
  action,
}: {
  slate: string;
  title: string;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-edge-soft pb-3">
      <div>
        <p className="eyebrow">{slate}</p>
        <h2 className="mt-1 text-2xl font-semibold text-bone sm:text-[1.75rem]">{title}</h2>
      </div>
      <div className="flex items-center gap-4">
        {meta && <p className="font-mono text-xs text-faint">{meta}</p>}
        {action}
      </div>
    </div>
  );
}

/** The poster surface behind every run card — a monitor, not a photograph. */
export function Poster({
  tone,
  children,
  className = "",
}: {
  tone: 0 | 1 | 2 | 3 | 4;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden border border-edge-soft ${className}`}
      style={{ background: POSTER_TONES[tone] }}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = "text-bone",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`mt-1 font-mono text-lg ${tone}`}>{value}</p>
    </div>
  );
}

export function Button({
  children,
  href,
  variant = "solid",
  className = "",
}: {
  children: ReactNode;
  href: string;
  variant?: "solid" | "ghost" | "quiet";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 px-4 py-2 font-mono text-xs font-semibold tracking-[0.1em] uppercase transition-colors";
  const variants = {
    solid: "bg-amber text-ink hover:bg-bone",
    ghost: "border border-edge text-bone hover:border-teal hover:text-teal",
    quiet: "text-muted hover:text-bone",
  } as const;
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}
