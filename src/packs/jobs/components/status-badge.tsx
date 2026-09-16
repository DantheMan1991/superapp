import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * A status chip, tinted rather than filled.
 *
 * ── THE RULE THIS EXISTS TO STOP BREAKING ───────────────────────────────────
 *
 * `globals.css` is explicit: a status chip is a pale tint plus dark text, never
 * a saturated fill. `--success` is a FILL at oklch(0.62) and
 * `--success-foreground` its legible twin at oklch(0.45); a chip drawing text
 * in the fill fails contrast on the card behind it.
 *
 * `Badge`'s own `variant="default"` is `bg-primary text-primary-foreground` — a
 * saturated fill — and every screen in this pack had reached for it to mark the
 * "good" status: a signed contract, an issued order, an accepted estimate, an
 * active job. Five copies of the same mistake, plus two near-identical
 * `STATUS_TONE` maps. One component, and the rule is stated once.
 *
 * ── TONES, NOT STATUSES ─────────────────────────────────────────────────────
 *
 * The tone says what a status MEANS, not what it is called. A contract is
 * `signed`, an order `issued`, an estimate `accepted` — three words for the
 * same fact, which is that the thing is real now. Each screen maps its own
 * vocabulary to a tone, because only that screen knows what its words mean.
 */
export type StatusTone =
  /** Real, agreed, done: the state the record was heading for. */
  | "good"
  /**
   * Normal, and not yet. A planned job and an estimate that has been sent are
   * going the right way; amber would read as a problem where there is none,
   * which is why this is a separate tone from `pending` rather than a shade of
   * it.
   */
  | "info"
  /** Waiting on somebody to act — a proposal out, a draft nobody has issued. */
  | "pending"
  /** Wrong, overdue, or money going the wrong way. */
  | "bad"
  /** Over, cancelled or withdrawn: true, and no longer interesting. */
  | "quiet";

const TONES: Record<StatusTone, string> = {
  good: "bg-success/15 text-success-foreground",
  info: "bg-primary/10 text-primary",
  pending: "bg-warning/15 text-warning-foreground",
  bad: "bg-destructive/10 text-destructive",
  quiet: "bg-muted text-muted-foreground",
};

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  // `secondary` rather than `default`, so the variant's own background is a
  // neutral the tone class overrides cleanly rather than a primary fill.
  return (
    <Badge variant="secondary" className={cn(TONES[tone], className)}>
      {children}
    </Badge>
  );
}

/**
 * The tones for a PROJECT's own status, shared by the module home's table and
 * the job page's header — the two places that showed the same badge from two
 * copies of the same map.
 */
export const PROJECT_STATUS_TONES: Record<string, StatusTone> = {
  active: "good",
  planned: "info",
  on_hold: "pending",
  complete: "quiet",
  cancelled: "quiet",
};

export function projectStatusTone(status: string): StatusTone {
  return PROJECT_STATUS_TONES[status] ?? "quiet";
}
