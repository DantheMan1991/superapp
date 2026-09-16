import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { formatMoney, formatMoneySign } from "@/lib/money";
import { cn } from "@/lib/utils";
import { wipPercentLabel } from "../wip-math";
import {
  BOARD_GROUPS,
  BOARD_GROUP_LABELS,
  BOARD_GROUP_TONES,
  type BoardGroupKey,
  boardGroupFor,
} from "../list-math";
import type { ProjectListEntry } from "../list-ops";
import type { BoardExtras } from "../list-ops";
import { BILLING_METHOD_LABELS, isBillingMethod, slugLabel } from "../vocabulary";

/**
 * The same jobs as the table, grouped by what is happening on site.
 *
 * ── WHY A SECOND VIEW AT ALL ────────────────────────────────────────────────
 *
 * The table answers "how is each job doing" a column at a time; the board
 * answers "what is going on" at a glance, which is the question somebody asks
 * standing up. Neither is a better version of the other, so the toggle is a
 * search param and the reader keeps whichever they chose.
 *
 * Both views read the SAME `ProjectListEntry`, so a figure cannot differ
 * between them — the board adds only what a card shows and a row does not (the
 * next scheduled item and what needs attention), through one batched read.
 */
export function ProjectBoard({
  entries,
  extras,
  symbol,
  clientWord,
}: {
  entries: readonly ProjectListEntry[];
  extras: Map<string, BoardExtras>;
  symbol: string | null;
  clientWord: string;
}) {
  const grouped = new Map<BoardGroupKey, ProjectListEntry[]>(
    BOARD_GROUPS.map((key) => [key, [] as ProjectListEntry[]]),
  );
  for (const entry of entries) {
    grouped.get(boardGroupFor(entry.row.project.status))!.push(entry);
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {BOARD_GROUPS.map((key) => {
        const column = grouped.get(key)!;
        return (
          <div key={key} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={cn("size-2 shrink-0 rounded-full", BOARD_GROUP_TONES[key])} />
              <h2 className="font-heading text-sm font-medium tracking-heading">
                {BOARD_GROUP_LABELS[key]}
              </h2>
              <span className="text-sm text-subtle-foreground tabular-nums">
                {column.length}
              </span>
            </div>

            {column.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-divider p-4 text-sm text-muted-foreground">
                Nothing here.
              </p>
            ) : (
              column.map((entry) => (
                <ProjectCard
                  key={entry.row.project.id}
                  entry={entry}
                  extras={extras.get(entry.row.project.id)}
                  symbol={symbol}
                  clientWord={clientWord}
                />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProjectCard({
  entry,
  extras,
  symbol,
  clientWord,
}: {
  entry: ProjectListEntry;
  extras: BoardExtras | undefined;
  symbol: string | null;
  clientWord: string;
}) {
  const { project, clientName } = entry.row;
  const measured = entry.valuation.kind === "measured" ? entry.valuation.figures : null;
  const ppm = measured?.percentCompletePpm ?? null;
  const done = project.status === "complete" || project.status === "cancelled";

  const method =
    entry.billingMethods.length > 1
      ? "Several"
      : entry.billingMethods.length === 1
        ? isBillingMethod(entry.billingMethods[0])
          ? BILLING_METHOD_LABELS[entry.billingMethods[0]]
          : slugLabel(entry.billingMethods[0])
        : null;

  return (
    <Link
      href={`/dashboard/m/jobs/${project.id}`}
      className={cn(
        "block rounded-2xl p-[18px] shadow-elevation-1 transition-shadow",
        "hover:shadow-elevation-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        // A finished job recedes. It is the one case where muting is right:
        // there is no next action on it, so it is genuinely inactive.
        done ? "bg-muted" : "bg-card",
      )}
    >
      <p className="font-mono text-xs text-subtle-foreground">{project.number}</p>
      <p className="mt-0.5 text-base font-semibold">{project.name}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {[clientName ?? `No ${clientWord.toLowerCase()}`, method].filter(Boolean).join(" · ")}
      </p>

      {/* A finished job has no ring: 100% on a job that is over says nothing. */}
      {!done && (
        <div className="mt-3 flex items-center gap-3">
          <ProgressRing ppm={ppm} />
          <div className="min-w-0 text-xs text-muted-foreground">
            {entry.valuation.kind === "by_hours" ? (
              <span>Billed by the hour</span>
            ) : ppm === null ? (
              <span>{entry.costToDateCents === 0 ? "Not started" : "No estimate"}</span>
            ) : (
              <>
                <span className="block tabular-nums">
                  {formatMoney(entry.costToDateCents, symbol)} spent
                </span>
                {entry.budgetCents > 0 && (
                  <span className="block tabular-nums">
                    of {formatMoney(entry.budgetCents, symbol)}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <hr className="my-3 border-divider" />

      <dl className="space-y-1 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Contract</dt>
          <dd className="font-medium tabular-nums">
            {entry.signedCount > 0 ? (
              formatMoneySign(entry.contractCents, symbol)
            ) : (
              <span className="text-muted-foreground">Nothing signed</span>
            )}
          </dd>
        </div>
        {measured && (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">
              {done
                ? "Gross profit"
                : measured.overBilledCents > 0
                  ? "Over-billed"
                  : "Under-billed"}
            </dt>
            <dd
              className={cn(
                "font-medium tabular-nums",
                !done && measured.overBilledCents > 0 && "text-destructive",
                !done && measured.underBilledCents > 0 && "text-success-foreground",
              )}
            >
              {done
                ? formatMoneySign(measured.grossProfitToDateCents, symbol)
                : formatMoney(
                    measured.overBilledCents > 0
                      ? measured.overBilledCents
                      : measured.underBilledCents,
                    symbol,
                  )}
            </dd>
          </div>
        )}
      </dl>

      {extras?.nextItem && (
        <p
          className={cn(
            "mt-3 flex items-center gap-1.5 text-xs",
            extras.nextItem.late ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <CalendarDays className="size-3.5 shrink-0" />
          <span className="truncate">
            {extras.nextItem.name}
            <span className="tabular-nums"> · {extras.nextItem.startOn}</span>
          </span>
        </p>
      )}

      {/*
        WHAT NEEDS SOMEBODY. Only things with a next action appear — a card
        covered in chips that mean nothing teaches people to stop reading them.
      */}
      <div className="mt-3 flex flex-wrap gap-1.5 empty:mt-0">
        {measured && measured.overBilledCents > 0 && !done && (
          <Chip tone="destructive">Billed ahead</Chip>
        )}
        {(extras?.overdueSelections ?? 0) > 0 ? (
          <Chip tone="destructive">
            {extras!.overdueSelections} selection
            {extras!.overdueSelections === 1 ? "" : "s"} overdue
          </Chip>
        ) : (
          (extras?.pendingSelections ?? 0) > 0 && (
            <Chip tone="warning">
              {extras!.pendingSelections} to choose
            </Chip>
          )
        )}
        {(extras?.lapsedCertificates ?? 0) > 0 && (
          <Chip tone="warning">
            {extras!.lapsedCertificates} certificate
            {extras!.lapsedCertificates === 1 ? "" : "s"} lapsing
          </Chip>
        )}
      </div>
    </Link>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: "destructive" | "warning";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-4xl px-2 py-0.5 text-xs font-medium",
        // A pale tint and dark text, never a saturated fill — the tokens' own
        // rule, and the reason `--warning` is not used for the words.
        tone === "destructive"
          ? "bg-destructive/10 text-destructive"
          : "bg-warning/15 text-warning-foreground",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Percent complete as a 52px ring.
 *
 * SVG rather than a conic gradient, because the arc has to start at twelve
 * o'clock and a gradient starts wherever the box says. The dash array is the
 * circumference and the offset is what is left of it — the standard trick, and
 * the reason the circle is rotated -90°.
 */
function ProgressRing({ ppm }: { ppm: number | null }) {
  const size = 52;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = ppm === null ? 0 : Math.min(1, Math.max(0, ppm / 1_000_000));

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={stroke}
      />
      {ppm !== null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--module-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground text-[11px] font-medium tabular-nums"
      >
        {ppm === null ? "—" : `${wipPercentLabel(ppm)}%`}
      </text>
    </svg>
  );
}
