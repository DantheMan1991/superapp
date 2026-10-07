import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";

const ARROW =
  "flex size-8 items-center justify-center rounded-full bg-card ring-1 ring-black/[0.06] hover:bg-food-field @2xl:bg-transparent @2xl:ring-0";

/**
 * BACK AND ON, A DAY OR A WEEK AT A TIME (Today's day, the week's week): on a
 * wide screen a pill with the arrows either side of where you are; on a phone
 * the arrows alone, the forward one only when there is somewhere to go. An
 * arrow with nowhere to go is grayed out.
 */
export function FoodPager({
  label,
  before,
  after,
  beforeLabel,
  afterLabel,
  ariaLabel,
}: {
  label: string;
  before: string | null;
  after: string | null;
  beforeLabel: string;
  afterLabel: string;
  ariaLabel: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="flex items-center gap-1.5 @2xl:h-10 @2xl:gap-0 @2xl:rounded-full @2xl:bg-card @2xl:px-1 @2xl:ring-1 @2xl:ring-black/[0.06]"
    >
      {before ? (
        <Link href={before} aria-label={beforeLabel} className={ARROW}>
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(ARROW, "opacity-30")} aria-hidden>
          <ChevronLeft className="size-4" />
        </span>
      )}
      <span className="hidden px-2 text-sm font-semibold whitespace-nowrap @2xl:inline">{label}</span>
      {after ? (
        <Link href={after} aria-label={afterLabel} className={ARROW}>
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(ARROW, "hidden opacity-30 @2xl:flex")} aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}

/**
 * A FOOD PAGE'S TOP (the Fresh Market skin, ADR 0132): the eyebrow, the
 * title in Food's face and a line under it; what the page does sits on the
 * right. On a wide screen the eyebrow is Food's tile and name; on a phone it
 * is a line of words (`phoneEyebrow`, "Food · Oct 5 to 11"). Inside a
 * `FoodPage`, whose width decides which.
 */
export function FoodHeader({
  title,
  phoneEyebrow = "Food",
  sub,
  subOnPhone = true,
  actions,
  className,
}: {
  title: ReactNode;
  phoneEyebrow?: string;
  sub?: ReactNode;
  /** Whether the line under the title shows on a phone too. */
  subOnPhone?: boolean;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-xs font-semibold text-food-accent-ink @2xl:text-[13px]">
          <span className="hidden size-7 items-center justify-center rounded-md bg-food-tint @2xl:flex" aria-hidden>
            <UtensilsCrossed className="size-4" />
          </span>
          <span className="@2xl:hidden">{phoneEyebrow}</span>
          <span className="hidden @2xl:inline">Food</span>
        </p>
        <h1 className="mt-1 font-food-display text-[28px] leading-[1.05] font-bold tracking-[-0.02em] @2xl:mt-2 @2xl:text-[38px] @2xl:tracking-[-0.03em]">
          {title}
        </h1>
        {sub && <p className={cn("mt-1.5 text-sm text-muted-foreground @2xl:text-[15px]", !subOnPhone && "hidden @2xl:block")}>{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5 @2xl:gap-2">{actions}</div>}
    </header>
  );
}
