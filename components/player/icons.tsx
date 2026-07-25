/**
 * The player's glyph set.
 *
 * These were `▶`, `❚❚` and `‹‹ 10s` — literal characters, which meant every
 * control was at the mercy of whichever font resolved them: different weights,
 * different optical sizes, different baselines, and on some systems a
 * colour-emoji play triangle. Drawn here instead, they share one grid, one
 * stroke weight and `currentColor`, so a row of controls finally lines up.
 *
 * All of them are `aria-hidden`: every button that carries one also carries its
 * own `aria-label`, and a duplicated name is worse than none.
 */

interface IconProps {
  /** Edge length in px. The control strip uses 14; the picture disc scales up. */
  size?: number;
  className?: string;
}

function Svg({
  size = 14,
  className = "",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Filled, not stroked: a play triangle reads as a solid at small sizes. */
export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 4.5 19.5 12 7 19.5Z" fill="currentColor" strokeLinejoin="round" />
    </Svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.5 4.5v15M15.5 4.5v15" strokeWidth={2.6} />
    </Svg>
  );
}

/** Skip back — the arc says "in time", which a bare chevron pair doesn't. */
export function BackIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 9.5A9 9 0 1 1 3 13" />
      <path d="M3 4.5v5h5" />
    </Svg>
  );
}

export function ForwardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20.5 9.5A9 9 0 1 0 21 13" />
      <path d="M21 4.5v5h-5" />
    </Svg>
  );
}

/**
 * The speaker. Three states, because a muted button that looks like a quiet one
 * is the single most confusing control on any player.
 */
export function VolumeIcon({ level, ...props }: IconProps & { level: "muted" | "low" | "high" }) {
  return (
    <Svg {...props}>
      <path d="M11 5 6.5 8.5H3.5v7h3L11 19Z" fill="currentColor" strokeLinejoin="round" />
      {level === "muted" ? (
        <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
      ) : (
        <>
          <path d="M14.8 9.4a3.6 3.6 0 0 1 0 5.2" />
          {level === "high" && <path d="M17.6 6.8a7.4 7.4 0 0 1 0 10.4" />}
        </>
      )}
    </Svg>
  );
}

export function FullscreenIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Svg>
  );
}

export function ExitFullscreenIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </Svg>
  );
}

/** Jump to live. An arrow into a bar — the edge of the stream, not a chevron. */
export function LiveEdgeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h11M11 7.5 15.5 12 11 16.5M19.5 5v14" />
    </Svg>
  );
}
