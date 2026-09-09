/**
 * What the stockroom owes a person. PURE — imports only the pack's own pure
 * units file, for the figures in the sentences.
 *
 * **THE DEVIATIONS EVERY SCREEN SHOWED AND NOBODY WAS TOLD.** The item page
 * has said "that is below zero" since slice 0, the hub has coloured a batch
 * past its date since slice 2, a count sits in `Being counted` forever, and
 * the matching page's own footnote says a delivery waiting longer than a
 * supplier takes to bill "is worth a look" — and every one of them waited for
 * somebody to open the page. `notifications.md` has the seam for exactly this:
 * an obligation is derived, never stored, and clears itself the moment the
 * thing is done. These five are that shape:
 *
 *   1. **Stock below zero.** Something was used before the delivery that
 *      covered it was entered. Allowed on purpose (the pack's oldest rule),
 *      which is precisely why somebody has to be told: the record is wrong
 *      until the delivery is entered or the count is walked.
 *   2. **A batch past its date, or going off within the week, with stock on
 *      hand.** A loss already taken, or one the week can still avoid. The
 *      middle of the hub's six-week horizon is not raised; that is a shelf to
 *      use first, not an obligation.
 *   3. **Stock at or below its reorder point.** The only figure the pack keeps
 *      that is a wish rather than a record; this is its only reader.
 *   4. **A count started two weeks ago and never posted.** Its shelves were
 *      walked and the record still disagrees. An EMPTY draft is not raised:
 *      it cannot be posted and cannot be deleted, so a line for it would never
 *      clear — the digest somebody mutes.
 *   5. **Deliveries that have waited two months for an invoice**, one line for
 *      the business. The matching page footnote says it; now something does.
 *
 * Dates are `YYYY-MM-DD` and day arithmetic goes through `Date.UTC`, the same
 * helper the other pure files carry: UTC has no daylight-saving day.
 */

import { formatQuantity } from "./units";

export type StockUrgency = "overdue" | "today" | "soon";

/** Structurally an `AttentionItem` — the source spreads it into one. */
export interface StockItem {
  key: string;
  title: string;
  detail?: string;
  urgency: StockUrgency;
  dueOn: string | null;
  href: string;
}

const BASE = "/dashboard/m/inventory";

/** A draft count this old has been walked and forgotten, not paused. */
export const COUNT_STALE_AFTER_DAYS = 14;
/** A priced delivery unbilled this long is an invoice nobody entered, or one that never came. */
export const UNBILLED_AFTER_DAYS = 60;
/** How close a date has to be before it is an obligation rather than a shelf to use first. */
export const GOES_OFF_WITHIN_DAYS = 7;
/** How many names the one-line items carry before "and N more". */
const NAMED_IN_DETAIL = 4;

/** `YYYY-MM-DD` → days since the epoch. Exact: UTC has no DST. */
function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole days from `from` to `to`; negative once `to` is behind `from`. */
export function daysFrom(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** `from` plus `days`, as `YYYY-MM-DD`. */
export function plusDays(from: string, days: number): string {
  return new Date((toEpochDay(from) + days) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

// ────────────────────────────────────────────────────────────── levels ───

export interface StockLevelLike {
  id: string;
  name: string;
  /** The stocking unit's code. */
  unit: string;
  /** Null when nothing has ever been recorded — not zero, and not raised. */
  onHand: number | null;
  reorderPoint: number | null;
}

/**
 * Every item below zero, one line each. `today`, not `overdue`: there is no
 * date it was due by, and the record is wrong now.
 */
export function belowZeroAttention(items: readonly StockLevelLike[]): StockItem[] {
  return items
    .filter((i) => i.onHand !== null && i.onHand < 0)
    .map((i) => ({
      key: `inventory-negative:${i.id}`,
      title: `${i.name} is below zero`,
      detail: `${formatQuantity(i.onHand, i.unit)} on hand — something was used before the delivery that covered it was entered`,
      urgency: "today",
      dueOn: null,
      href: `${BASE}/${i.id}`,
    }));
}

/**
 * Every item at or below its reorder point, one line each. An item below zero
 * is `belowZeroAttention`'s and is not raised twice; an item nothing has ever
 * been recorded for is not "down to" anything.
 */
export function lowStockAttention(items: readonly StockLevelLike[]): StockItem[] {
  return items
    .filter(
      (i) =>
        i.reorderPoint !== null &&
        i.onHand !== null &&
        i.onHand >= 0 &&
        i.onHand <= i.reorderPoint,
    )
    .map((i) => ({
      key: `inventory-low:${i.id}`,
      title:
        i.onHand === 0
          ? `${i.name} is out`
          : `${i.name} is down to ${formatQuantity(i.onHand, i.unit)}`,
      detail: `Reorder at ${formatQuantity(i.reorderPoint, i.unit)}`,
      // Out is today's problem; low is this week's.
      urgency: i.onHand === 0 ? "today" : "soon",
      dueOn: null,
      href: `${BASE}/${i.id}`,
    }));
}

// ─────────────────────────────────────────────────────────────── dates ───

export interface DatedLotLike {
  lotId: string;
  code: string;
  itemId: string;
  itemName: string;
  unit: string;
  /** What is on hand in the batch. Nothing on hand cannot go off into a loss. */
  balance: number;
  expiresOn: string;
}

/**
 * Batches past their date (`overdue`), going off today (`today`) or within
 * the week (`soon`), with stock on hand. Beyond the week is the hub's job.
 */
export function goingOffAttention(
  lots: readonly DatedLotLike[],
  today: string,
): StockItem[] {
  const out: StockItem[] = [];
  for (const lot of lots) {
    if (lot.balance <= 0) continue;
    const days = daysFrom(today, lot.expiresOn);
    if (days > GOES_OFF_WITHIN_DAYS) continue;
    const who = `${lot.code} of ${lot.itemName}`;
    const title =
      days < 0
        ? `${who} is past its date`
        : days === 0
          ? `${who} goes off today`
          : days === 1
            ? `${who} goes off tomorrow`
            : `${who} goes off in ${days} days`;
    out.push({
      key: `inventory-expiry:${lot.lotId}`,
      title,
      detail: `${formatQuantity(lot.balance, lot.unit)} on hand · good until ${lot.expiresOn}`,
      urgency: days < 0 ? "overdue" : days === 0 ? "today" : "soon",
      dueOn: lot.expiresOn,
      href: `${BASE}/${lot.itemId}`,
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────── counts ───

export interface DraftCountLike {
  id: string;
  countedOn: string;
  /** The place, or `Everywhere`. */
  where: string;
  /** Shelves written down. Zero is an abandoned start and is not raised. */
  lines: number;
}

/** Draft counts walked `COUNT_STALE_AFTER_DAYS` ago or more, with shelves on them. */
export function staleCountAttention(
  counts: readonly DraftCountLike[],
  today: string,
): StockItem[] {
  return counts
    .filter((c) => c.lines > 0 && daysFrom(c.countedOn, today) >= COUNT_STALE_AFTER_DAYS)
    .map((c) => {
      const days = daysFrom(c.countedOn, today);
      return {
        key: `inventory-count:${c.id}`,
        title: `A count from ${c.countedOn} has not been posted`,
        detail: `${c.where} · ${c.lines} ${c.lines === 1 ? "shelf" : "shelves"} written down · ${days} days ago`,
        urgency: "today" as const,
        dueOn: null,
        href: `${BASE}/counts/${c.id}`,
      };
    });
}

// ─────────────────────────────────────────────────────────── invoices ───

export interface UnbilledLike {
  movementId: string;
  itemName: string;
  occurredOn: string;
}

/**
 * Priced deliveries unbilled for `UNBILLED_AFTER_DAYS` or more, as ONE line
 * for the business: reconciling them is one job on one page, and six lines
 * would be the digest somebody mutes. Names the oldest few.
 */
export function unbilledAttention(
  receipts: readonly UnbilledLike[],
  today: string,
): StockItem[] {
  const old = receipts
    .filter((r) => daysFrom(r.occurredOn, today) >= UNBILLED_AFTER_DAYS)
    .sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : 1));
  if (old.length === 0) return [];
  const named = old
    .slice(0, NAMED_IN_DETAIL)
    .map((r) => `${r.itemName} (${r.occurredOn})`)
    .join(", ");
  const more = old.length - Math.min(old.length, NAMED_IN_DETAIL);
  const first = old[0];
  return [
    {
      key: "inventory-unbilled",
      title:
        old.length === 1
          ? `A ${first.itemName} delivery from ${first.occurredOn} has waited ${daysFrom(first.occurredOn, today)} days for its invoice`
          : // `>=` is the filter, so "more than 60" was wrong on the day
            // a delivery turned 60 — the case the threshold exists for.
            `${old.length} deliveries have waited ${UNBILLED_AFTER_DAYS} days or more for an invoice`,
      detail:
        old.length === 1
          ? "An invoice nobody entered, or one that never came"
          : `${named}${more > 0 ? `, and ${more} more` : ""}`,
      urgency: "soon",
      dueOn: null,
      href: `${BASE}/matching`,
    },
  ];
}
