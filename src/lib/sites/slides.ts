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
