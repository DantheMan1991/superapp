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
 * is; this is the screen catching up with it — and it must catch up EXACTLY,
 * neither blocking a save the server accepts nor passing one it refuses.
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
 * **WHAT A PICKER OFFERS AND WHAT THE SERVER ACCEPTS ARE TWO RULES**, and for
 * invoice lines they differ. The picker offers income accounts only, mirroring
 * `sales/invoices/new`; the server's floor (`assertCodableAccounts`) is
 * codable, and deliberately so — a deposit to Unearned Revenue is a valid
 * invoice line. A stored value that the picker would not OFFER but the server
 * ACCEPTS is offered back plain, not marked: marking it would block a save the
 * server would take. `accept` defaults to `offer` for the two kinds where the
 * rules coincide (journal: anything; bill: codable).
 */
export interface AccountRules<A> {
  /** What a new pick may be. */
  offer: (account: A) => boolean;
  /** What a save is allowed to name. Defaults to `offer`. */
  accept?: (account: A) => boolean;
}

/**
 * Accounts that are active AND offered, plus any the record already names
 * that are not — offered back either plain (still accepted by the server) or
 * marked with why it is not.
 *
 * The two marks are different asks. An inactive account may be reactivated or
 * re-picked; an account that "cannot be chosen by hand" (a bank register, GRNI,
 * inventory — see `isCodableAccount`) must be re-picked, full stop, because the
 * rule that excludes it is about what a line may do, not the account's state.
 */
export function accountOptions<
  A extends { id: string; code: string; name: string; isActive: boolean },
>(
  accounts: ReadonlyArray<A>,
  rules: AccountRules<A>,
  keepIds: readonly string[] = [],
): AccountPickOption[] {
  const accept = rules.accept ?? rules.offer;
  const keep = new Set(keepIds);
  const out: AccountPickOption[] = [];
  for (const a of accounts) {
    if (a.isActive && rules.offer(a)) {
      out.push({ id: a.id, code: a.code, name: a.name });
    } else if (keep.has(a.id)) {
      out.push(
        !a.isActive
          ? { id: a.id, code: a.code, name: `${a.name} (inactive)`, unpickable: "inactive" }
          : accept(a)
            ? { id: a.id, code: a.code, name: a.name }
            : {
                id: a.id,
                code: a.code,
                name: `${a.name} (cannot be chosen)`,
                unpickable: "not_codable",
              },
      );
    }
  }
  return out;
}

/**
 * What the Save button says while a kept value is still selected. One
 * sentence, in the dialog's own words, naming the thing and the way out — the
 * facts the server would otherwise send back after the click, said before it.
 * Reactivation is offered where the app can do it (a party, an account);
 * an account that cannot be chosen by hand has no such exit.
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
    ? `${subject} is inactive. Pick another, or reactivate it first.`
    : `${subject} can no longer be chosen by hand. Pick another.`;
}

/** A line the dialog will actually SUBMIT, with the number the person sees. */
export interface BlockerLine {
  /** 1-based, as displayed — rows the dialog discards keep their neighbours' numbers. */
  line: number;
  accountId: string;
}

export type BlockerInput =
  | {
      kind: "bill";
      vendors: ReadonlyArray<PartyPickOption>;
      vendorId: string;
      accounts: ReadonlyArray<AccountPickOption>;
      accountId: string;
    }
  | {
      kind: "invoice";
      customers: ReadonlyArray<PartyPickOption>;
      customerId: string;
      accounts: ReadonlyArray<AccountPickOption>;
      lines: ReadonlyArray<BlockerLine>;
    }
  | {
      kind: "journal";
      accounts: ReadonlyArray<AccountPickOption>;
      lines: ReadonlyArray<BlockerLine>;
    };

const markOf = (
  options: ReadonlyArray<{ id: string; unpickable?: Unpickable }>,
  id: string,
): Unpickable | undefined => options.find((o) => o.id === id)?.unpickable;

/**
 * **THE ONE SENTENCE THAT BLOCKS A SAVE, or null.** Party first, then lines in
 * display order; first blocker wins, because there is one line of text for it
 * and fixing the first re-runs this. Pure, so all three kinds are testable
 * without mounting the dialog. The caller passes only the lines it will
 * submit — a journal row with no amount is discarded at save and must not
 * hold the save hostage over an account that is about to be dropped.
 */
export function saveBlocker(input: BlockerInput): string | null {
  if (input.kind === "bill") {
    const v = markOf(input.vendors, input.vendorId);
    if (v) return unpickableSentence("supplier", v);
    const a = markOf(input.accounts, input.accountId);
    return a ? unpickableSentence("account", a) : null;
  }
  if (input.kind === "invoice") {
    const c = markOf(input.customers, input.customerId);
    if (c) return unpickableSentence("customer", c);
  }
  for (const l of input.lines) {
    const a = markOf(input.accounts, l.accountId);
    if (a) return unpickableSentence("account", a, l.line);
  }
  return null;
}
