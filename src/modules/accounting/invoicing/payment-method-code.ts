/**
 * Deriving a payment method's stored code from its display name — pure, no
 * `server-only`, so the browser can preview the code before saving and the
 * server derives the same one.
 *
 * THE CODE NEVER CHANGES AFTER CREATION. `invoice_payments.method` stores it
 * and there is deliberately no foreign key, so a code that shifted would
 * orphan every payment that recorded it: the payment would still say
 * `bank_transfer` while the list called it something else. Renaming a method
 * therefore renames the LABEL only, which is why this is called once, at
 * creation, and never on update.
 */
export function codeFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
