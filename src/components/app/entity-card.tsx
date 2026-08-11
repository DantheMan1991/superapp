import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The module accent hues, reused as a monogram palette.
 *
 * Deliberately six hand-picked hues rather than a hash across the whole colour
 * wheel: a grid of cards in arbitrary hues looks like a chart, not a shelf.
 * These already exist as tokens and already have dark-mode values, so a
 * monogram stays legible in both themes for free.
 */
const TINTS = [
  "--accent-accounting",
  "--accent-crm",
  "--accent-documents",
  "--accent-email",
  "--accent-scheduling",
  "--accent-work",
] as const;

/**
 * Stable tint for a name — the same customer is always the same colour, across
 * sessions and across pages, because it is derived from the name rather than
 * from position in a list.
 */
function tintFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100_000;
  }
  return `var(${TINTS[hash % TINTS.length]})`;
}

/** First letters of the first two words: "Harbor Rd Partners" → "HR". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

interface EntityCardProps {
  href: string;
  title: string;
  /** Up to two lines. More than two and the card stops being scannable. */
  meta?: ReactNode[];
  /**
   * A thumbnail, avatar or preview. Omit it and the card renders a monogram
   * tinted from `title` — which is how this works for records that have no
   * image at all, i.e. most of them.
   */
  visual?: ReactNode;
  /** Floats over the visual, top left. Status, not a second title. */
  badge?: ReactNode;
  /** Floats over the visual, top right. Pin, star, overflow menu. */
  action?: ReactNode;
  className?: string;
}

/**
 * A record, as a card.
 *
 * This is the one place the Airbnb reference is copied nearly literally,
 * because the shape genuinely fits: a visual block, then a tight title, then
 * two quiet lines of metadata, with the whole thing a single click target. The
 * detail worth noting is the badge — translucent white carrying the full rest
 * elevation, so it reads as floating *above* the visual rather than printed on
 * it. That one trick is most of why their cards feel physical.
 *
 * Hover lifts the card and scales the visual very slightly inside its own
 * rounded box. `overflow-hidden` on the visual wrapper is what keeps the scale
 * from bleeding past the corner radius.
 */
export function EntityCard({
  href,
  title,
  meta,
  visual,
  badge,
  action,
  className,
}: EntityCardProps) {
  const tint = tintFor(title);

  return (
    <div className={cn("group/entity relative", className)}>
      <Link
        href={href}
        className="block rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div
          className="relative flex aspect-4/3 items-center justify-center overflow-hidden rounded-xl"
          style={{
            background: `color-mix(in oklab, ${tint} 16%, var(--card))`,
            color: tint,
          }}
        >
          {visual ?? (
            <span className="font-heading text-3xl font-semibold tracking-heading">
              {initials(title)}
            </span>
          )}
        </div>
        <p className="mt-2 truncate text-[15px] font-medium">{title}</p>
        {meta?.slice(0, 2).map((line, i) => (
          <p
            key={i}
            className={cn(
              "truncate text-[13px]",
              // Two tiers, not one: the second line has to recede or the card
              // reads as three equally important facts.
              i === 0 ? "text-muted-foreground" : "text-subtle-foreground",
            )}
          >
            {line}
          </p>
        ))}
      </Link>

      {/* Outside the Link, so a badge or a star is not also a navigation
          click. Both are positioned against the card, not the anchor. */}
      {badge && (
        <div className="pointer-events-none absolute top-2 left-2 rounded-[14px] bg-card/85 px-2.5 py-1 text-[11px] font-semibold shadow-elevation-1 backdrop-blur-sm">
          {badge}
        </div>
      )}
      {action && <div className="absolute top-1.5 right-1.5">{action}</div>}
    </div>
  );
}
