"use client";
/* eslint-disable @next/next/no-img-element -- our own image routes, already sized and cached */

import { useCallback, useEffect, useRef, useState } from "react";
import { slideLabel, swipeDirection, wrapIndex, type Slide } from "@/lib/sites/slides";

/**
 * The public site's one moving part: photos shown one at a time.
 *
 * `Slideshow` is the section; `Gallery` is the grid whose tiles open a
 * `Lightbox` over the page. Both are plain elements styled with the site's
 * CSS variables, no library, because this is the business's page and the
 * third client script on it (after the view beacon and the enquiry form).
 *
 * What it promises a visitor: the first photo is in the server-rendered
 * HTML, so it shows before any script runs; every gallery tile stays a
 * link to the photo's own address, so without JavaScript it opens in a
 * new tab; the arrows and dots are buttons with names; a slideshow that
 * moves by itself stops while the pointer or the keyboard is on it, has a
 * Pause, and never moves at all for a visitor whose device asks for less
 * motion; the lightbox is a dialog that closes on Escape and hands focus
 * back to the tile it came from; a swipe across either moves it, and the
 * arrow keys move a slideshow whose buttons have focus. Only the current
 * photo is in the page; the next is fetched ahead, so a twelve-photo show
 * does not load twelve photos at once.
 */

const ARROW =
  "absolute top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-neutral-900 shadow hover:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--site-primary)]";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === "left" ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
    </svg>
  );
}

function Cross() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Fetch the photo after this one, so pressing next never waits. */
function usePreloadNext(slides: Slide[], index: number): void {
  useEffect(() => {
    const next = slides[wrapIndex(index + 1, slides.length)];
    if (next && slides.length > 1) {
      const img = new Image();
      img.src = next.src;
    }
  }, [slides, index]);
}

/**
 * A swipe across the photo. The pointer's start is remembered on press and
 * judged on release with `swipeDirection`; pointer events cover a finger
 * and a mouse alike, and `touch-action: pan-y` on the element leaves
 * vertical scrolling to the browser and takes only the sideways move. A
 * release that ended a swipe also fires a click, so `consumeSwipe` lets a
 * click handler ask whether to ignore it.
 */
function useSwipe(onSwipe: (dir: -1 | 1) => void): {
  consumeSwipe: () => boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
    style: React.CSSProperties;
  };
} {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  return {
    consumeSwipe: () => {
      const was = swiped.current;
      swiped.current = false;
      return was;
    },
    handlers: {
      onPointerDown: (e) => {
        if (e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        swiped.current = false;
      },
      onPointerUp: (e) => {
        const from = start.current;
        start.current = null;
        if (!from || from.id !== e.pointerId) return;
        const dir = swipeDirection(e.clientX - from.x, e.clientY - from.y);
        if (dir === 0) return;
        swiped.current = true;
        onSwipe(dir);
      },
      onPointerCancel: () => {
        start.current = null;
      },
      style: { touchAction: "pan-y" },
    },
  };
}

export function Slideshow({
  slides,
  seconds,
  layout,
  onDark = false,
}: {
  slides: Slide[];
  /** Between photos; 0 moves only on a press. */
  seconds: number;
  layout: "inset" | "wide";
  /** On a dark band or a photo: the caption row and the dots turn light. */
  onDark?: boolean;
}) {
  const n = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const reduced = usePrefersReducedMotion();
  const go = useCallback((by: number) => setIndex((i) => wrapIndex(i + by, n)), [n]);
  usePreloadNext(slides, index);
  const swipe = useSwipe(go);

  const moves = seconds > 0 && n > 1 && !reduced;
  useEffect(() => {
    if (!moves || paused || held) return;
    const timer = window.setInterval(() => go(1), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [moves, paused, held, seconds, go]);

  if (n === 0) return null;
  const slide = slides[wrapIndex(index, n)];
  const frame =
    layout === "wide"
      ? "relative aspect-[16/9] max-h-[70vh] w-full overflow-hidden bg-neutral-100"
      : "relative aspect-[3/2] w-full overflow-hidden rounded-2xl bg-neutral-100";
  return (
    <div
      className="space-y-3"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      onKeyDown={(e) => {
        if (n < 2) return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        }
      }}
    >
      <div className={frame} {...swipe.handlers}>
        <img
          key={slide.src}
          src={slide.src}
          alt={slide.alt}
          width={slide.width}
          height={slide.height}
          loading={index === 0 ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          className="h-full w-full select-none object-cover"
        />
        {n > 1 && (
          <>
            <button type="button" className={`${ARROW} left-3`} aria-label="Previous photo" onClick={() => go(-1)}>
              <Chevron dir="left" />
            </button>
            <button type="button" className={`${ARROW} right-3`} aria-label="Next photo" onClick={() => go(1)}>
              <Chevron dir="right" />
            </button>
          </>
        )}
      </div>
      <div className={`flex flex-wrap items-center justify-between gap-3 ${layout === "wide" ? "mx-auto max-w-5xl px-6" : "px-1"}`}>
        <p className={`min-h-5 text-sm ${onDark ? "text-neutral-200" : "text-neutral-600"}`} aria-live="polite">
          {slide.caption}
          <span className="sr-only"> {slideLabel(index, n)}</span>
        </p>
        {n > 1 && (
          <div className="flex items-center gap-3">
            {moves && (
              <button
                type="button"
                className={`text-xs underline-offset-4 hover:underline ${onDark ? "text-neutral-200" : "text-neutral-600"}`}
                aria-pressed={paused}
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? "Play" : "Pause"}
              </button>
            )}
            <div className="flex gap-1.5" role="group" aria-label="Photos">
              {slides.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={slideLabel(i, n)}
                  aria-current={i === index ? "true" : undefined}
                  onClick={() => setIndex(i)}
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: i === index ? (onDark ? "#ffffff" : "var(--site-primary)") : onDark ? "rgba(255,255,255,0.45)" : "#d4d4d4" }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Gallery({
  heading,
  tiles,
  columns,
  captionClass = "text-neutral-600",
}: {
  heading: string;
  tiles: Slide[];
  columns: 2 | 3 | 4;
  /** The captions' colour class, from the section's tone. */
  captionClass?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const triggers = useRef<(HTMLAnchorElement | null)[]>([]);
  const cols =
    columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "sm:grid-cols-3 lg:grid-cols-4" : "sm:grid-cols-3";
  return (
    <div>
      {heading && <h2 className="text-2xl font-semibold tracking-tight">{heading}</h2>}
      <ul className={`mt-6 grid grid-cols-2 gap-4 ${cols}`}>
        {tiles.map((tile, i) => (
          <li key={i}>
            <figure>
              {/* A link to the photo itself: without a script it opens in a new tab. */}
              <a
                href={tile.src}
                target="_blank"
                rel="noopener"
                ref={(el) => {
                  triggers.current[i] = el;
                }}
                className="block overflow-hidden rounded-xl bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-[var(--site-primary)]"
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(i);
                }}
              >
                <img
                  src={tile.src}
                  alt={tile.alt}
                  width={tile.width}
                  height={tile.height}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/3] w-full object-cover"
                />
              </a>
              {tile.caption && <figcaption className={`mt-2 text-sm ${captionClass}`}>{tile.caption}</figcaption>}
            </figure>
          </li>
        ))}
      </ul>
      {open !== null && (
        <Lightbox
          slides={tiles}
          index={open}
          onIndex={setOpen}
          onClose={() => {
            const from = open;
            setOpen(null);
            triggers.current[from]?.focus();
          }}
        />
      )}
    </div>
  );
}

function Lightbox({
  slides,
  index,
  onIndex,
  onClose,
}: {
  slides: Slide[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const n = slides.length;
  const slide = slides[wrapIndex(index, n)];
  const closeRef = useRef<HTMLButtonElement>(null);
  usePreloadNext(slides, index);
  const swipe = useSwipe((dir) => onIndex(wrapIndex(index + dir, n)));

  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onIndex(wrapIndex(index + 1, n));
      else if (e.key === "ArrowLeft") onIndex(wrapIndex(index - 1, n));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, n, onClose, onIndex]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={slideLabel(index, n)}
      className="fixed inset-0 z-50 flex flex-col bg-neutral-950/95 text-white"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-sm text-neutral-300" aria-live="polite">
          {slideLabel(index, n)}
        </p>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          className="rounded-full p-2 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"
          onClick={onClose}
        >
          <Cross />
        </button>
      </div>
      {/* A click on the dark around the photo closes; a click on the photo, or the end of a swipe, does not. */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-14"
        {...swipe.handlers}
        onClick={(e) => {
          if (swipe.consumeSwipe()) return;
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <img
          key={slide.src}
          src={slide.src}
          alt={slide.alt}
          width={slide.width}
          height={slide.height}
          decoding="async"
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
        />
        {n > 1 && (
          <>
            <button type="button" className={`${ARROW} left-3`} aria-label="Previous photo" onClick={() => onIndex(wrapIndex(index - 1, n))}>
              <Chevron dir="left" />
            </button>
            <button type="button" className={`${ARROW} right-3`} aria-label="Next photo" onClick={() => onIndex(wrapIndex(index + 1, n))}>
              <Chevron dir="right" />
            </button>
          </>
        )}
      </div>
      <p className="min-h-5 px-6 py-4 text-center text-sm text-neutral-200">{slide.caption}</p>
    </div>
  );
}
