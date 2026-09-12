/**
 * What kind of hour this is. NO IMPORTS AND NO DIRECTIVE — the picker renders
 * these in the browser.
 *
 * THE ONE CLOSED TAXONOMY IN THIS MODULE, and the schema comment on
 * `time_entries.pay_type` carries the argument: the overtime evaluator arriving
 * in slice 2 must answer "does this hour count toward the 40?" for every entry,
 * and a value it has never seen cannot be classified safely in either
 * direction. A new code is a migration plus a line here, on purpose.
 */

export const PAY_TYPES = ["worked", "paid_leave", "holiday", "unpaid"] as const;

export type PayType = (typeof PAY_TYPES)[number];

export function isPayType(value: string): value is PayType {
  return (PAY_TYPES as readonly string[]).includes(value);
}

/**
 * THE PROPERTY THE WHOLE MODULE TURNS ON. Paid leave and holiday are on the
 * paycheck and are NOT hours worked, so they never count toward the 40 that
 * triggers overtime. Getting this backwards overpays every week anybody takes a
 * day off, and it is the most common defect in this domain — which is why it is
 * one exported predicate rather than a condition written out at each call site.
 *
 * Unpaid is neither: not worked, not paid. It exists so an unpaid absence can
 * be recorded rather than left as a hole somebody has to explain later.
 */
export function countsAsWorked(payType: string): boolean {
  return payType === "worked";
}

/** On the paycheck, whether or not anybody was at work. */
export function countsAsPaid(payType: string): boolean {
  return payType === "worked" || payType === "paid_leave" || payType === "holiday";
}

export function payTypeLabel(payType: string): string {
  switch (payType) {
    case "worked":
      return "Worked";
    case "paid_leave":
      return "Paid leave";
    case "holiday":
      return "Holiday";
    case "unpaid":
      return "Unpaid";
    default:
      return payType;
  }
}
