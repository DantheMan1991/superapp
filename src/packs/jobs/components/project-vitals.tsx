import { formatMoney, formatMoneySign } from "@/lib/money";
import { cn } from "@/lib/utils";
import { barPercent } from "../list-math";
import { wipPercentLabel } from "../wip-math";
import type { ProjectVitals } from "../vitals-ops";

/**
 * The five numbers that say where a job stands, on every tab of its page.
 *
 * ── ONE CARD, NOT FIVE ──────────────────────────────────────────────────────
 *
 * Five separate `StatCard`s would read as five things to compare. These five
 * are one thing — the job's position — read left to right: what it is worth,
 * what has been ordered against it, what it has cost, how far along it is, and
 * whether the billing is ahead or behind. So they share one rounded card and
 * are divided by hairlines rather than by gaps, which is the `gap-px` over a
 * `--divider` background below: the gap IS the rule.
 *
 * It stays put as somebody moves between tabs because it is the page's
 * identity rather than one tab's content — see `[id]/layout.tsx`.
 *
 * Two cells on a phone, not five: five columns at 375px gives each figure 67px,
 * which is narrower than "$1,964,500.00". FIVE IS AN ODD NUMBER, so at two and
 * three columns the last cell would leave a hole — and because the gaps ARE the
 * divider showing through, that hole renders as a grey block rather than as
 * nothing. The last cell spans the remainder until the row fits it exactly.
 */
export function ProjectVitalsStrip({
  vitals,
  symbol,
}: {
  vitals: ProjectVitals;
  symbol: string | null;
}) {
  const measured = vitals.valuation.kind === "measured" ? vitals.valuation.figures : null;
  const ppm = measured?.percentCompletePpm ?? null;
  const complete = vitals.project.status === "complete";

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-divider shadow-elevation-1 sm:grid-cols-3 lg:grid-cols-5">
      <Cell
        label="Contract"
        value={
          vitals.signedCount > 0 ? (
            formatMoneySign(vitals.contractCents, symbol)
          ) : (
            <span className="text-muted-foreground">Nothing signed</span>
          )
        }
        note={
          vitals.signedCount > 0
            ? vitals.changesCents !== 0
              ? `incl. ${formatMoneySign(vitals.changesCents, symbol)} in changes`
              : "revised"
            : vitals.proposedCents > 0
              ? `${formatMoneySign(vitals.proposedCents, symbol)} proposed`
              : "nothing out for signature"
        }
        noteTone={vitals.signedCount === 0 && vitals.proposedCents > 0 ? "warning" : "default"}
      />

      <Cell
        label="Committed"
        value={formatMoney(vitals.committedCents, symbol)}
        note="ordered, billed or not"
      />

      <Cell
        label="Actual cost"
        value={formatMoney(vitals.actualCents, symbol)}
        note="from the ledger"
      />

      <Cell
        label="Complete"
        value={
          vitals.valuation.kind === "by_hours" ? (
            <span className="text-muted-foreground">By hours</span>
          ) : ppm !== null ? (
            `${wipPercentLabel(ppm)}%`
          ) : vitals.actualCents === 0 ? (
            <span className="text-muted-foreground">Not started</span>
          ) : (
            <span className="text-warning-foreground">No estimate</span>
          )
        }
        note={
          vitals.budgetCents > 0
            ? `${formatMoney(vitals.actualCents, symbol)} of ${formatMoney(vitals.budgetCents, symbol)}`
            : "no budget to measure against"
        }
      >
        {ppm !== null && (
          <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-module-accent"
              style={{ width: `${barPercent(ppm)}%` }}
            />
          </span>
        )}
      </Cell>

      <Cell
        className="col-span-2 lg:col-span-1"
        label="Billed vs earned"
        value={formatMoney(vitals.billedCents, symbol)}
        note={
          measured ? (
            complete ? (
              /* Once a job is done the variance is spent; what it made is not. */
              `${formatMoneySign(measured.grossProfitToDateCents, symbol)} gross profit`
            ) : measured.underBilledCents > 0 ? (
              <span className="text-success-foreground">
                {formatMoney(measured.underBilledCents, symbol)} under-billed
              </span>
            ) : measured.overBilledCents > 0 ? (
              <span className="text-destructive">
                {formatMoney(measured.overBilledCents, symbol)} over-billed
              </span>
            ) : (
              "level with earned"
            )
          ) : vitals.valuation.kind === "by_hours" ? (
            "earned on the WIP schedule"
          ) : (
            "nothing earned against it yet"
          )
        }
      />
    </div>
  );
}

function Cell({
  label,
  value,
  note,
  noteTone = "default",
  className,
  children,
}: {
  label: string;
  value: React.ReactNode;
  note: React.ReactNode;
  noteTone?: "default" | "warning";
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("bg-card p-4", className)}>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-xl font-semibold tracking-heading tabular-nums">
        {value}
      </p>
      <p
        className={cn(
          "mt-1 text-xs tabular-nums",
          noteTone === "warning" ? "text-warning-foreground" : "text-subtle-foreground",
        )}
      >
        {note}
      </p>
      {children}
    </div>
  );
}
