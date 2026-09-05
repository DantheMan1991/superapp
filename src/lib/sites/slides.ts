/**
 * What a slideshow and a lightbox share, pure: the shape of a slide as the
 * client component takes it (the server resolves the address and the size),
 * wrapping around the ends, and the words on the controls.
 */
export interface Slide {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
}

/** `i` brought back into `0 … n-1`, from either end. Zero slides is index zero. */
export function wrapIndex(i: number, n: number): number {
  if (n <= 0) return 0;
  return ((i % n) + n) % n;
}

export function slideLabel(i: number, n: number): string {
  return `Photo ${i + 1} of ${n}`;
}

/** The choices the editor offers. Zero is "only when a visitor presses an arrow". */
export const SLIDESHOW_SECONDS = [0, 4, 6, 10] as const;

export function secondsLabel(seconds: number): string {
  return seconds === 0 ? "Only when pressed" : `Every ${seconds} seconds`;
}

/** How far a finger must travel, in CSS pixels, before a drag is a swipe rather than a wobble. */
export const SWIPE_THRESHOLD = 40;

/**
 * What a drag meant: `1` next (the finger moved left), `-1` previous (it
 * moved right), `0` nothing — too short, or more up-and-down than across,
 * which is a scroll the browser already handled.
 */
export function swipeDirection(dx: number, dy: number, threshold = SWIPE_THRESHOLD): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
