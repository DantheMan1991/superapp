/**
 * When a service is due. PURE — no imports, no `server-only`, no database.
 *
 * Two kinds, and they are genuinely different rather than two settings of one
 * thing. A tractor that sat all winter does not need its 100-hour service; a
 * fire extinguisher needs its annual check whether or not anyone touched it.
 */

export const MAINTENANCE_KINDS = ["calendar", "meter"] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export function isMaintenanceKind(v: string): v is MaintenanceKind {
  return (MAINTENANCE_KINDS as readonly string[]).includes(v);
}

export interface ScheduleSpec {
  kind: MaintenanceKind;
  /** Calendar only. */
  intervalMonths?: number | null;
  /** Meter only. */
  intervalMeter?: number | null;
}

export interface DueInput {
  spec: ScheduleSpec;
  /**
   * When this service was last done, if ever. `null` means never — which is
   * not the same as overdue, see `status` below.
   */
  lastDoneOn?: string | null;
  lastDoneMeter?: number | null;
  /**
   * The fallback anchor for a calendar schedule that has never been done:
   * usually the asset's in-service or acquisition date. `null` when the asset
   * carries neither.
   */
  anchorOn?: string | null;
  /** Latest meter reading, for meter schedules. */
  currentMeter?: number | null;
  /** The tenant's today. Never the server's. */
  today: string;
}

export type DueStatus =
  /** Nothing to compute from — no baseline date or reading exists. */
  | "no_baseline"
  | "ok"
  | "due";

export interface DueResult {
  status: DueStatus;
  /** Calendar schedules: the date it falls due. */
  dueOn?: string | null;
  /** Meter schedules: the reading it falls due at. */
  dueAtMeter?: number | null;
  /** Negative when overdue. Days for calendar, units for meter. */
  remaining?: number | null;
}

function addMonths(iso: string, months: number): string {
  // Parsed by hand rather than through `Date`, because `new Date("2026-01-31")`
  // plus a month is the classic "March 3rd" bug. Clamps to the month's last
  // day, so a service done on the 31st recurs on the 30th of a short month
  // rather than jumping into the next one.
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  const d = Number(iso.slice(8, 10));
  const target = m + months;
  const year = y + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Whole days between two ISO dates. Positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.UTC(
    Number(b.slice(0, 4)),
    Number(b.slice(5, 7)) - 1,
    Number(b.slice(8, 10)),
  ) -
    Date.UTC(
      Number(a.slice(0, 4)),
      Number(a.slice(5, 7)) - 1,
      Number(a.slice(8, 10)),
    );
  return Math.round(ms / 86_400_000);
}

/**
 * Is this service due, and when.
 *
 * NEVER-DONE IS `no_baseline`, NOT OVERDUE, and the distinction is what stops
 * this being a nuisance. Adding a schedule to a tractor you have owned for
 * years should not immediately declare six services overdue and raise six work
 * items — it should say it does not know when the oil was last changed, and
 * wait for somebody to record one. The first maintenance event sets the clock.
 *
 * The one exception is a calendar schedule on an asset with an in-service or
 * acquisition date: that IS a usable baseline, because the interval can honestly
 * be counted from the day the thing entered service.
 */
export function computeDue(input: DueInput): DueResult {
  const { spec } = input;

  if (spec.kind === "calendar") {
    const interval = spec.intervalMonths ?? 0;
    if (interval <= 0) return { status: "no_baseline" };
    const anchor = input.lastDoneOn ?? input.anchorOn ?? null;
    if (!anchor) return { status: "no_baseline" };
    const dueOn = addMonths(anchor, interval);
    const remaining = daysBetween(input.today, dueOn);
    return { status: remaining <= 0 ? "due" : "ok", dueOn, remaining };
  }

  const interval = spec.intervalMeter ?? 0;
  if (interval <= 0) return { status: "no_baseline" };
  // A meter schedule has no equivalent of the in-service fallback: "how many
  // hours had it done when we bought it" is not something the asset knows, so
  // without either a recorded service or a reading there is nothing to count
  // from.
  if (input.currentMeter === null || input.currentMeter === undefined) {
    return { status: "no_baseline" };
  }
  const base = input.lastDoneMeter ?? 0;
  const dueAtMeter = base + interval;
  const remaining = dueAtMeter - input.currentMeter;
  return { status: remaining <= 0 ? "due" : "ok", dueAtMeter, remaining };
}

/** What the work item raised for this service should be called. */
export function maintenanceWorkTitle(
  assetName: string,
  scheduleName: string,
): string {
  return `${scheduleName} — ${assetName}`;
}

/**
 * How a due service reads to a person.
 *
 * Calendar schedules get a date, meter schedules get a reading, and neither is
 * dressed up as the other: "due at 500 hours" is not a date and pretending
 * otherwise would put a fictional deadline on a work item.
 */
export function dueSummary(result: DueResult, meterUnit?: string | null): string {
  if (result.status === "no_baseline") return "No baseline yet";
  if (result.dueOn) {
    const days = result.remaining ?? 0;
    if (days < 0) return `Overdue by ${Math.abs(days)} days`;
    if (days === 0) return "Due today";
    return `Due in ${days} days`;
  }
  const unit = meterUnit ?? "units";
  const left = result.remaining ?? 0;
  if (left < 0) return `Overdue by ${Math.abs(left)} ${unit}`;
  if (left === 0) return "Due now";
  return `Due in ${left} ${unit}`;
}
