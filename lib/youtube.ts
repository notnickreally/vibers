/**
 * A run's picture comes from a YouTube URL the viber pastes in — a live stream,
 * a premiere, or a recorded VOD. Everything YouTube hands out is accepted:
 * watch links, share links, /live/, /embed/, /shorts/, or a bare video id.
 */

const ID = /^[A-Za-z0-9_-]{11}$/;

export interface YouTubeSource {
  id: string;
  /** Seconds to start at, if the URL carried a timestamp. */
  start?: number;
}

function parseStart(value: string | null): number | undefined {
  if (!value) return undefined;
  // YouTube writes timestamps as either "90" or "1h2m30s".
  if (/^\d+$/.test(value)) return Number(value);
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m?.[0]) return undefined;
  const [, h, min, s] = m;
  const total = Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
  return total > 0 ? total : undefined;
}

/** Returns null for anything that isn't recognisably a YouTube video. */
export function parseYouTube(input: string): YouTubeSource | null {
  const raw = input.trim();
  if (!raw) return null;
  if (ID.test(raw)) return { id: raw };

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const start = parseStart(url.searchParams.get("t") ?? url.searchParams.get("start"));
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    const id = segments[0];
    return id && ID.test(id) ? { id, start } : null;
  }

  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;

  const v = url.searchParams.get("v");
  if (v && ID.test(v)) return { id: v, start };

  // /live/ID, /embed/ID, /shorts/ID, /v/ID
  if (["live", "embed", "shorts", "v"].includes(segments[0])) {
    const id = segments[1];
    if (id && ID.test(id)) return { id, start };
  }

  return null;
}

/** Privacy-preserving embed URL. Autoplay only works muted, so it starts muted. */
export function embedUrl(source: YouTubeSource, { autoplay = true } = {}): string {
  const params = new URLSearchParams({
    autoplay: autoplay ? "1" : "0",
    mute: autoplay ? "1" : "0",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
  });
  if (source.start) params.set("start", String(source.start));
  return `https://www.youtube-nocookie.com/embed/${source.id}?${params}`;
}

export function watchUrl(source: YouTubeSource): string {
  return `https://www.youtube.com/watch?v=${source.id}`;
}

/** Poster frame, used before the player mounts and in the go-live preview. */
export function thumbnailUrl(source: YouTubeSource): string {
  return `https://i.ytimg.com/vi/${source.id}/hqdefault.jpg`;
}

const KEY_PREFIX = "vibers:stream:";

export function loadSource(handle: string): YouTubeSource | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + handle);
    return raw ? (JSON.parse(raw) as YouTubeSource) : null;
  } catch {
    return null;
  }
}

export function saveSource(handle: string, source: YouTubeSource | null): void {
  if (typeof window === "undefined") return;
  try {
    if (source) window.localStorage.setItem(KEY_PREFIX + handle, JSON.stringify(source));
    else window.localStorage.removeItem(KEY_PREFIX + handle);
  } catch {
    // Private browsing — the source just won't persist past this page.
  }
}
