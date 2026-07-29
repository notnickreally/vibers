"use client";

import { type ChangeEvent, useCallback, useRef, useState } from "react";
import {
  ICON_ACCEPT,
  ICON_PATH,
  ICON_REFUSAL,
  ICON_TYPE_LABEL,
  type IconSummary,
  iconPreviewUrl,
  MAX_ICON_BYTES,
  parseIconUpload,
  sizeLabel,
} from "@/lib/icon";

/**
 * The favicon section of the panel.
 *
 * The tab's face used to be a file in the build, which meant changing it was a
 * commit, a review and a deploy. It is a row in Neon now, and this is where it
 * is changed — so the thing to say on screen, and the thing this section says
 * twice, is **who it changes it for**: everybody. Same sentence the wall gets,
 * for the same reason.
 *
 * Three details are deliberate:
 *
 * - **The file is checked twice, by the same code.** `parseIconUpload` runs
 *   here so a wrong file is refused before it crosses the wire, and runs again
 *   in `/api/admin/icon` because that is the copy that decides. Sharing the
 *   module is what stops the two answers from disagreeing.
 * - **The preview is the file, not the tab.** What is shown after picking is
 *   the `data:` URL that is about to be uploaded, so the operator is looking at
 *   the bytes they chose rather than at whatever their browser last cached.
 * - **The tab updates on save.** The site's `<link rel="icon">` is a fixed URL
 *   with a one-minute cache, which is right for visitors and wrong for the
 *   person who just pressed the button — so the link's `href` is re-pointed at
 *   a cache-busted URL right here, and the tab changes while they watch.
 */

/** Deterministic, and UTC — a locale-formatted date would differ across hydration. */
function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Re-point the live `<link rel="icon">` so this tab shows the new icon now.
 *
 * Replacing the element rather than mutating its `href` is the part that
 * actually works: browsers treat an icon link they have already resolved as
 * settled, and a removed-then-added node is a new one to resolve.
 */
function repaintTab(version: number | null): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  const fresh = document.createElement("link");
  fresh.rel = "icon";
  fresh.href = iconPreviewUrl(version);
  link?.remove();
  document.head.appendChild(fresh);
}

interface Picked {
  dataUrl: string;
  name: string;
  bytes: number;
  label: string;
}

interface Answer {
  icon?: IconSummary | null;
  error?: string;
}

export function SiteIcon({ initial }: { initial: IconSummary | null }) {
  const [icon, setIcon] = useState(initial);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const clearPick = useCallback(() => {
    setPicked(null);
    if (field.current) field.current.value = "";
  }, []);

  const pick = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setNote(null);
      setError(null);
      const file = event.target.files?.[0];
      if (!file) {
        clearPick();
        return;
      }
      // Refused before the read even finishes for the one case where the file's
      // own size is enough to know — a 4 MB PNG should not be turned into a
      // 5.5 MB string to be told no.
      if (file.size > MAX_ICON_BYTES) {
        setError(ICON_REFUSAL["too-big"]);
        clearPick();
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => {
        setError(ICON_REFUSAL.malformed);
        clearPick();
      };
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        const upload = parseIconUpload(dataUrl);
        if (!upload.ok) {
          setError(ICON_REFUSAL[upload.reason]);
          clearPick();
          return;
        }
        const size = upload.icon.width ? ` · ${upload.icon.width}×${upload.icon.height}` : "";
        setPicked({
          dataUrl,
          name: file.name,
          bytes: upload.icon.bytes,
          label: `${ICON_TYPE_LABEL[upload.icon.contentType]} · ${sizeLabel(upload.icon.bytes)}${size}`,
        });
      };
      reader.readAsDataURL(file);
    },
    [clearPick],
  );

  const act = useCallback(async (label: string, init: RequestInit): Promise<Answer | null> => {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/admin/icon", init);
      const data = (await response.json().catch(() => ({}))) as Answer;
      if (!response.ok) {
        // A 401 means the session went away underneath us — expired, or a
        // credential changed. Sending them back to the gate is the only useful
        // thing to do about it.
        if (response.status === 401) {
          window.location.assign("/admin/login");
          return null;
        }
        setError(data.error ?? "That didn't work.");
        return null;
      }
      const next = data.icon ?? null;
      setIcon(next);
      repaintTab(next?.updatedAt ?? null);
      return data;
    } catch {
      setError("Couldn't reach the server.");
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const save = useCallback(async () => {
    if (!picked) return;
    const data = await act("save", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl: picked.dataUrl }),
    });
    if (!data) return;
    clearPick();
    setNote("Up, in everybody's tab. A browser that has been here already picks it up within the minute.");
  }, [act, clearPick, picked]);

  const restore = useCallback(async () => {
    const data = await act("restore", { method: "DELETE" });
    if (!data) return;
    clearPick();
    setNote("Back to the icon this build ships with.");
  }, [act, clearPick]);

  const showing = picked?.dataUrl ?? iconPreviewUrl(icon?.updatedAt ?? null);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">The tab</p>
          <p className="mt-1 max-w-prose text-[15px] text-muted">
            The favicon the whole site wears. Changing it changes it for everyone — it is one
            image in the database, not a setting on this browser.
          </p>
        </div>
        <button
          type="button"
          disabled={busy !== null || icon === null}
          onClick={restore}
          className="border border-edge px-3 py-2 font-mono text-[11px] tracking-[0.12em] text-muted uppercase transition-colors hover:border-del hover:text-del disabled:opacity-40"
        >
          {busy === "restore" ? "Restoring…" : "Restore default"}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 border border-edge-soft bg-panel p-4">
        {/* A checked backdrop, because a favicon is transparent more often than
            not and a dark square on a dark panel is not a preview. */}
        <div
          className="grid size-16 shrink-0 place-items-center border border-edge"
          style={{
            backgroundImage:
              "linear-gradient(45deg,#1b1b22 25%,transparent 25%),linear-gradient(-45deg,#1b1b22 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1b1b22 75%),linear-gradient(-45deg,transparent 75%,#1b1b22 75%)",
            backgroundSize: "12px 12px",
            backgroundPosition: "0 0,0 6px,6px -6px,-6px 0",
          }}
        >
          <img src={showing} alt="" width={32} height={32} className="size-8 object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[12px] text-bone">
            {picked
              ? picked.name
              : icon === null
                ? "The default is up."
                : `${ICON_TYPE_LABEL[icon.contentType]} · ${sizeLabel(icon.bytes)}${
                    icon.width ? ` · ${icon.width}×${icon.height}` : ""
                  }`}
          </p>
          <p className="mt-1 font-mono text-[11px] text-faint">
            {picked
              ? `${picked.label} · not up yet`
              : icon === null
                ? `${ICON_PATH} serves the file this build ships with until somebody uploads one.`
                : `changed ${day(icon.updatedAt)}${icon.updatedBy ? ` by ${icon.updatedBy}` : ""}`}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="icon-file">
          A PNG, ICO or SVG to use as the favicon
        </label>
        <input
          id="icon-file"
          ref={field}
          type="file"
          accept={ICON_ACCEPT}
          onChange={pick}
          className="max-w-full flex-1 border border-edge bg-panel px-3 py-2 font-mono text-[12px] text-muted file:mr-3 file:border-0 file:bg-panel-2 file:px-3 file:py-1 file:font-mono file:text-[11px] file:tracking-[0.12em] file:text-bone file:uppercase hover:file:text-teal"
        />
        <button
          type="button"
          disabled={busy !== null || picked === null}
          onClick={save}
          className="border border-edge px-4 py-2 font-mono text-[11px] tracking-[0.12em] text-bone uppercase transition-colors hover:border-teal hover:text-teal disabled:opacity-40"
        >
          {busy === "save" ? "Putting it up…" : "Put it up"}
        </button>
      </div>

      <p className="mt-2 font-mono text-[11px] text-faint">
        PNG, ICO or SVG, up to {sizeLabel(MAX_ICON_BYTES)}. Square and 32 or 64 pixels is what a
        tab actually shows. The file's own bytes decide what it is — a renamed extension is
        refused.
      </p>

      <div aria-live="polite" className="mt-3 min-h-[1.75rem]">
        {error && <p className="font-mono text-[12px] text-del">{error}</p>}
        {note && !error && <p className="font-mono text-[12px] text-teal">{note}</p>}
      </div>
    </section>
  );
}
