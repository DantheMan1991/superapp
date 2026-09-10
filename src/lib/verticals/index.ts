import { homestead } from "./homestead";
import type { Vertical } from "./types";

export type { Vertical, VerticalSection, VerticalLink } from "./types";

/**
 * THE ONE FILE THAT NAMES A VERTICAL.
 *
 * Order is the order they appear on `/for` and in the industries strip on the
 * landing page — deliberate, not alphabetical, because the first one is the
 * one we most want read.
 *
 * Adding an industry is: a file beside `homestead.ts`, a line here, and a
 * build-log entry in docs/modules/public-site.md. There is no second site to
 * stand up, no second deploy, and no second header and footer to keep in step.
 */
export const verticalRegistry: readonly Vertical[] = [homestead];

export function getVertical(slug: string): Vertical | null {
  return verticalRegistry.find((v) => v.slug === slug) ?? null;
}

/** Every vertical, for the list page, the sitemap and `generateStaticParams`. */
export function listVerticals(): readonly Vertical[] {
  return verticalRegistry;
}
