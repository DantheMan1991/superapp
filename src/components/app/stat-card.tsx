import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Small print under the value — a comparison, a count, or a link's label. */
  footnote?: ReactNode;
  /**
   * Colours the value only. The label and footnote stay neutral: a card where
   * every line is red reads as broken rather than as "this figure is overdue".
   */
  tone?: "default" | "destructive" | "success" | "accent";
  /** Makes the whole card the link target, which is the larger hit area. */
  href?: string;
  className?: string;
}

const TONES: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "",
  destructive: "text-destructive",
  success: "text-success",
  accent: "text-module-accent",
};

/**
 * One figure, and what it means.
 *
 * The typographic relationship is lifted from how Airbnb renders a price: the
 * number carries the weight, everything around it is deliberately quieter, and
 * the qualifier sits directly beneath rather than beside. `tabular-nums` so a
 * row of these does not jitter as the figures change — the same reason the
 * sidebar's unread badge uses it.
 *
 * Replaces eight near-identical hand-built cards in `AccountingModule.tsx`,
 * which had drifted into three different value sizes.
 */
export function StatCard({
  label,
  value,
  footnote,
  tone = "default",
  href,
  className,
}: StatCardProps) {
  const body = (
    <>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-heading text-2xl font-semibold tracking-heading tabular-nums",
          TONES[tone],
        )}
      >
        {value}
      </p>
      {footnote && (
        <p className="mt-1.5 text-xs text-subtle-foreground">{footnote}</p>
      )}
    </>
  );

  const shell = cn(
    "block rounded-xl bg-card p-4 shadow-elevation-1",
    // The lift is the whole hover affordance — no border change, no tint.
    href &&
      "transition-shadow hover:shadow-elevation-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
    className,
  );

  return href ? (
    <Link href={href} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
