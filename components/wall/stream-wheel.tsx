"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { watchHref } from "@/lib/source";
import type { Stream } from "@/lib/stream";
import { drumOffset, drumSeat, drumTransform } from "@/lib/wheel";

/**
 * The wall beside a playing stream, as a wheel.
 *
 * It is a wheel for a reason that isn't looks. This strip used to be a plain
 * list sitting in the page's own scroll, which meant scrolling *it* was
 * scrolling *the page*: get far enough down the wall and the stream you opened
 * the page to watch had scrolled off the top of it. A wall you can't browse
 * without losing the picture is a wall you don't browse.
 *
 * So the strip gets its own axle. It scrolls inside itself and — on the wide
 * layout, where it sits beside the picture — refuses to hand the leftover
 * scroll up to the page (`overscroll-contain`), so the picture stays exactly
 * where it was however long you spin. That is the fix. Everything below is the
 * consequence: a thing that turns on an axle should look like a thing that
 * turns on an axle, so the tiles ride a drum — leaning away, receding and
 * dimming toward each rim, with the one at the axle square-on and lit.
 *
 * Three things worth knowing about how it is drawn:
 *
 * - **The geometry is `lib/wheel.ts`, not CSS.** A scroll-driven CSS animation
 *   (`animation-timeline: view()`) would do this without JavaScript, but only in
 *   the engines that have it, and silently flatten in the rest. A transform per
 *   frame works everywhere and is a number this repo can test.
 * - **Every measurement happens before any write.** Reading a tile's box after
 *   writing its transform makes the browser re-lay-out the list once per tile —
 *   the difference between a wheel and a slideshow.
 * - **No turn, no drum.** A wall short enough to fit doesn't scroll, so there is
 *   nothing to bring to the axle; tilting and dimming tiles nobody can reach
 *   would be a list pretending to be a wheel. It stays a list until it can turn.
 */
export function StreamWheel({ streams }: { streams: Stream[] }) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);
  // The drum is decoration laid over a scroll region; the containment underneath
  // it is not. So this takes away the motion and keeps the fix: someone who has
  // asked for less movement gets a flat, still list that still can't drag the
  // picture off screen.
  const [still, setStill] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setStill(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);

  useEffect(() => {
    const wheel = wheelRef.current;
    const track = trackRef.current;
    if (!wheel || !track) return;

    const cells = () => Array.from(track.children) as HTMLElement[];

    // Nothing is left behind on the tiles: the styles the drum writes are
    // inline, so flattening means removing them rather than overriding them.
    const flatten = () => {
      wheel.removeAttribute("data-turning");
      track.style.perspectiveOrigin = "";
      for (const cell of cells()) {
        cell.style.transform = "";
        cell.style.opacity = "";
        cell.removeAttribute("data-hub");
      }
    };

    if (still) {
      flatten();
      return;
    }

    let frame = 0;

    const place = () => {
      frame = 0;
      // One overflowing pixel is a rounding artefact, not a scrollable wall.
      if (wheel.scrollHeight - wheel.clientHeight <= 1) {
        flatten();
        return;
      }
      wheel.dataset.turning = "true";
      const box = wheel.getBoundingClientRect();
      const axle = box.top + box.height / 2;
      const half = box.height / 2;
      // The perspective sits on the track so the tiles are direct children of it
      // — the alternative put `preserve-3d` in between, which is what made the
      // whole wall unclickable (see `.stream-wheel-track` in globals.css). The
      // price is this line: `perspective-origin` is resolved against the track,
      // which is the whole scrollable list, so the eye has to be moved to the
      // middle of the *window* on it. Left at its own 50% the wheel would bulge
      // around the middle of the wall and skew everywhere else.
      track.style.perspectiveOrigin = `50% ${wheel.scrollTop + wheel.clientHeight / 2}px`;
      const seated = cells();
      const seats = seated.map((cell) => {
        const rect = cell.getBoundingClientRect();
        return drumSeat(drumOffset(rect.top + rect.height / 2, axle, half));
      });
      seated.forEach((cell, i) => {
        const seat = seats[i];
        cell.style.transform = drumTransform(seat);
        cell.style.opacity = String(seat.opacity);
        if (seat.hub) cell.dataset.hub = "true";
        else cell.removeAttribute("data-hub");
      });
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(place);
    };

    // Tabbing into a tile at the rim would otherwise leave it where the browser
    // put it — just barely on screen, turned away and dimmed to almost nothing,
    // with its focus ring dimmed along with it. Keyboard focus turns the wheel
    // instead, which is what a pointer would have done to reach the same tile.
    const centre = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const cell = target.closest(".stream-wheel-cell");
      cell?.scrollIntoView({ block: "center", behavior: "smooth" });
    };

    place();
    wheel.addEventListener("scroll", schedule, { passive: true });
    track.addEventListener("focusin", centre);
    // The wheel is sticky and height-bounded, so its own box changes with the
    // window; neither that nor a re-render fires `scroll`, and both move every
    // tile's seat. Watched separately rather than by listing the streams as a
    // dependency: the wall arrives after this mounts and changes under it, and
    // re-running the whole effect to re-measure is the long way round.
    const sized = new ResizeObserver(schedule);
    sized.observe(wheel);
    sized.observe(track);
    const listed = new MutationObserver(schedule);
    listed.observe(track, { childList: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      wheel.removeEventListener("scroll", schedule);
      track.removeEventListener("focusin", centre);
      sized.disconnect();
      listed.disconnect();
    };
  }, [still]);

  return (
    <div
      ref={wheelRef}
      // Bounded even where it doesn't sit beside the picture, so the wall is
      // never the whole screen; below `xl` it keeps its scroll to itself only
      // while it has scroll left, because down there it is the last thing on the
      // page and swallowing the overflow would trap you above the footer.
      className="stream-wheel scrollbar-thin max-h-[70vh] min-h-0 xl:max-h-none xl:overscroll-contain"
    >
      <ul ref={trackRef} className="stream-wheel-track">
        {streams.map((s) => (
          <li key={s.videoId} className="stream-wheel-cell">
            <Link href={watchHref(s.videoId)} className="group flex gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.thumbnail}
                alt=""
                loading="lazy"
                className="h-14 w-24 shrink-0 border border-edge-soft object-cover transition-colors"
              />
              <span className="min-w-0">
                <span className="line-clamp-2 block text-[13px] leading-snug text-bone group-hover:text-amber">
                  {s.title}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10px] text-faint">
                  {s.channel}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
