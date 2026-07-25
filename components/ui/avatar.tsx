/**
 * Monogram tile. No uploaded images anywhere in this build — an avatar is
 * derived from the handle so every viber looks consistent across the site.
 */
export function Avatar({
  handle,
  hue,
  size = 36,
  live = false,
}: {
  handle: string;
  hue: number;
  size?: number;
  live?: boolean;
}) {
  const initials = handle.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase();
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        aria-hidden
        className="grid h-full w-full place-items-center rounded-[3px] font-mono font-semibold"
        style={{
          fontSize: size * 0.36,
          background: `linear-gradient(150deg, hsl(${hue} 62% 26%), hsl(${(hue + 40) % 360} 48% 14%))`,
          color: `hsl(${hue} 88% 78%)`,
          border: `1px solid hsl(${hue} 40% 34%)`,
        }}
      >
        {initials}
      </span>
      {live && (
        <span
          aria-hidden
          className="tally-lamp absolute -right-1 -bottom-1 h-2.5 w-2.5 rounded-full bg-tally ring-2 ring-ink"
        />
      )}
    </span>
  );
}
