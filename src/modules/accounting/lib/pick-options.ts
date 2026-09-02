/**
 * **A SELECT THAT CANNOT SHOW ITS VALUE RENDERS BLANK, AND A BLANK LIES.**
 * Pure, no `server-only` — the dialog reads the marks it produces.
 *
 * A recurring template names a party and one account per line. Deactivate
 * that supplier, or make that account unpickable (retire it, or match a
 * receipt so the line is coded to a bank register), and the edit dialog's
 * option list — active and pickable only, rightly — no longer contains the
 * stored value. Radix then shows an empty trigger: the old name is gone,
 * nothing says why, Save stays enabled, and the server refuses with a sentence
 * about a supplier the screen never named. The list row had the same hole and
 * fell back to the word "Supplier".
 *
 * The rule here is the one `dimensionTypesFrom` already applies to a retired
 * tag with `keepIds`: **offer the stored value back, marked, so it can be seen
 * and changed — and never offer it to anyone who does not already hold it.**
 * A kept option carries `unpickable`, which the dialog turns into a disabled
 * item, a blocked Save, and a sentence that says what to do. The server's
 * refusal (`VENDOR_INACTIVE`, `ACCOUNT_NOT_CODABLE`, …) stays exactly where it
 * is; this is the screen catching up with it.
 */

export type Unpickable = "inactive" | "not_codable";

export interface PartyPickOption {
  id: string;
  name: string;
  /** Set only on a value the record already holds and may no longer pick. */
  unpickable?: Unpickable;
}

export interface AccountPickOption {
  id: string;
  code: string;
  name: string;
  /** Set only on a value the record already holds and may no longer pick. */
  unpickable?: Unpickable;
}

/**
 * Active parties, plus the one the record already names if it is inactive —
 * offered back, marked. `keepId` absent (creating) means active only.
 */
export function partyOptions(
  parties: ReadonlyArray<{ id: string; name: string; isActive: boolean }>,
  keepId?: string | null,
): PartyPickOption[] {
  const out: PartyPickOption[] = [];
  for (const p of parties) {
    if (p.isActive) {
      out.push({ id: p.id, name: p.name });
    } else if (keepId && p.id === keepId) {
      out.push({ id: p.id, name: `${p.name} (inactive)`, unpickable: "inactive" });
    }
  }
  return out;
}

/**
 * Accounts that are active AND pass `pickable` (income only for an invoice
 * line, codable for a bill line, anything for a journal line), plus any the
 * record already names that fail either test — marked with which.
 *
 * The two marks are different asks. An inactive account may be reactivated or
 * re-picked; an account that "cannot be chosen by hand" (a bank register, GRNI,
 * inventory — see `isCodableAccount`) must be re-picked, full stop, because the
 * rule that excludes it is about what a bill line may do, not about the
 * account's state.
 */
export function accountOptions<
  A extends { id: string; code: string; name: string; isActive: boolean },
>(
  accounts: ReadonlyArray<A>,
  pickable: (account: A) => boolean,
  keepIds: readonly string[] = [],
): AccountPickOption[] {
  const keep = new Set(keepIds);
  const out: AccountPickOption[] = [];
  for (const a of accounts) {
    if (a.isActive && pickable(a)) {
      out.push({ id: a.id, code: a.code, name: a.name });
    } else if (keep.has(a.id)) {
      out.push(
        a.isActive
          ? {
              id: a.id,
              code: a.code,
              name: `${a.name} (cannot be chosen)`,
              unpickable: "not_codable",
            }
          : { id: a.id, code: a.code, name: `${a.name} (inactive)`, unpickable: "inactive" },
      );
    }
  }
  return out;
}

/**
 * What the Save button says while a kept value is still selected. One
 * sentence, naming the thing and the way out — the same two sentences the
 * server would send back, said before the click instead of after.
 */
export function unpickableSentence(
  what: "supplier" | "customer" | "account",
  reason: Unpickable,
  line?: number,
): string {
  if (what !== "account") {
    return `That ${what} is inactive. Pick another, or reactivate them first.`;
  }
  const subject = line === undefined ? "The account" : `Line ${line}'s account`;
  return reason === "inactive"
    ? `${subject} is inactive. Pick another.`
    : `${subject} can no longer be chosen by hand. Pick another.`;
}
