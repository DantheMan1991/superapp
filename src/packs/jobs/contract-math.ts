import { APPROVED_CHANGE_STATUSES, VALUED_CONTRACT_STATUSES } from "./vocabulary";

/**
 * What a job's agreements are worth, derived from rows already loaded.
 *
 * ── WHY THIS IS A FUNCTION AND NOT TWO COPIES ───────────────────────────────
 *
 * The Contracts panel and the Changes panel need the same six figures, and
 * until the project page was split into tabs (jobs redesign 2a) they shared
 * them by being in the same file. Two pages copying the derivation is exactly
 * how the revised value on one screen starts disagreeing with the revised value
 * on the other — so it is one function, and `tests/jobs-contract-math.test.ts`
 * pins it.
 *
 * The rules themselves are not re-decided here. `VALUED_CONTRACT_STATUSES` and
 * `APPROVED_CHANGE_STATUSES` are the same exported constants `projectValues`
 * applies in SQL for the list, so the list, the vitals strip and these panels
 * cannot drift into disagreeing about what a job is worth.
 *
 * Structural parameter types, so this stays a pure module a client component
 * may read — the same discipline as `wip-math.ts`.
 */
export interface ContractLike {
  id: string;
  status: string;
  valueCents: number | null;
}

export interface ChangeOrderRowLike {
  changeOrder: { status: string; valueCents: number };
  contract: { id: string };
}

export interface ContractSummary<C extends ContractLike> {
  /** Signed and complete only — a concept the client has not signed is not money. */
  valued: C[];
  /** Approved changes per contract id. A change on a contract that does not count is never read. */
  approvedByContract: Map<string, number>;
  /** Original + approved changes: what one agreement is worth NOW. */
  revisedOf: (c: { id: string; valueCents: number | null }) => number;
  /** Σ revised over counted contracts. */
  signedValue: number;
  /** The approved changes alone, over counted contracts. */
  changesValue: number;
  signedCount: number;
  approvedCount: number;
  proposedChangeCount: number;
  /** Agreements still out for signature. */
  proposedCount: number;
}

export function contractSummary<C extends ContractLike>(
  contracts: readonly C[],
  changeOrders: readonly ChangeOrderRowLike[],
): ContractSummary<C> {
  const valued = contracts.filter((c) =>
    (VALUED_CONTRACT_STATUSES as readonly string[]).includes(c.status),
  );

  const approvedByContract = new Map<string, number>();
  for (const row of changeOrders) {
    if (!(APPROVED_CHANGE_STATUSES as readonly string[]).includes(row.changeOrder.status)) {
      continue;
    }
    approvedByContract.set(
      row.contract.id,
      (approvedByContract.get(row.contract.id) ?? 0) + row.changeOrder.valueCents,
    );
  }

  const revisedOf = (c: { id: string; valueCents: number | null }) =>
    (c.valueCents ?? 0) + (approvedByContract.get(c.id) ?? 0);

  return {
    valued,
    approvedByContract,
    revisedOf,
    signedValue: valued.reduce((sum, c) => sum + revisedOf(c), 0),
    changesValue: valued.reduce((sum, c) => sum + (approvedByContract.get(c.id) ?? 0), 0),
    signedCount: valued.length,
    approvedCount: changeOrders.filter((r) =>
      (APPROVED_CHANGE_STATUSES as readonly string[]).includes(r.changeOrder.status),
    ).length,
    proposedChangeCount: changeOrders.filter((r) => r.changeOrder.status === "proposed").length,
    proposedCount: contracts.filter((c) => c.status === "proposed").length,
  };
}
