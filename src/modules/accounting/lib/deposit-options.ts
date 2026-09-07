/**
 * Where a customer's payment can be deposited — pure, no `server-only`.
 *
 * Every active register, including other companies', then Undeposited Funds.
 * An account that belongs to somebody else is labelled with that company's
 * name, because depositing into it is an INTERCOMPANY payment (ADR 0010, the
 * mirror of the bill case): recorded as a linked pair rather than refused,
 * and the dialog says so before it happens. The label is set ONLY when the
 * owner differs — on the single-company tenant, which is most of them, every
 * row would otherwise carry the same noise.
 *
 * Undeposited Funds goes last and is never labelled: it is a chart account,
 * not a register, so it has no owner and both companies' unbanked cheques sit
 * in it.
 *
 * Shared by the invoice page and the invoice list, which offers the same
 * dialog on a row — one function, so the two cannot drift.
 */

export interface DepositRegister {
  /** The register's LEDGER account id — what the payment records. */
  accountId: string;
  name: string;
  entityId: string;
}

export interface DepositCompany {
  id: string;
  name: string;
}

export interface DepositOption {
  id: string;
  label: string;
  /** Set only when the account belongs to another company. */
  otherCompany?: string;
}

export interface PaidFromRegister {
  ledgerAccountId: string;
  name: string;
  kind: string;
  /** Set only when the account belongs to another company. */
  otherCompany?: string;
}

/**
 * Where a bill can be paid from: every active register, the other companies'
 * labelled. The mirror of `depositOptionsFor` for money going OUT — paying
 * from an affiliate's account is the intercompany pair the bill dialog
 * warns about before it happens. No Undeposited Funds here: a bill is never
 * paid from it. Shared by the bill page and the Bills list, which offers the
 * same dialog on a row.
 */
export function paidFromRegistersFor(args: {
  registers: readonly (DepositRegister & { kind: string })[];
  companies: readonly DepositCompany[];
  /** The bill's company. */
  entityId: string;
}): PaidFromRegister[] {
  const companyName = new Map(args.companies.map((c) => [c.id, c.name]));
  return args.registers.map((r) => ({
    ledgerAccountId: r.accountId,
    name: r.name,
    kind: r.kind,
    otherCompany:
      r.entityId === args.entityId
        ? undefined
        : (companyName.get(r.entityId) ?? "another company"),
  }));
}

export function depositOptionsFor(args: {
  registers: readonly DepositRegister[];
  companies: readonly DepositCompany[];
  /** The Undeposited Funds account's id, or null when the chart has none. */
  undepositedAccountId: string | null;
  /** The invoice's company. */
  entityId: string;
}): DepositOption[] {
  const companyName = new Map(args.companies.map((c) => [c.id, c.name]));
  const options: DepositOption[] = args.registers.map((r) => ({
    id: r.accountId,
    label: r.name,
    otherCompany:
      r.entityId === args.entityId
        ? undefined
        : (companyName.get(r.entityId) ?? "another company"),
  }));
  if (args.undepositedAccountId) {
    options.push({ id: args.undepositedAccountId, label: "Undeposited Funds" });
  }
  return options;
}
