/**
 * What the console may not do to the operator tenant.
 *
 * The operator tenant is the business that runs the platform, running on it
 * (ADR 0041, docs/modules/back-office.md): Yosher as a tenant, its clients as
 * parties in its own CRM, its money in its own books. To RLS it is an ordinary
 * tenant, and tests/isolation/operator.test.ts keeps it that way. What makes
 * it special is only this file: the console has buttons that make no sense
 * pointed at the platform's own workspace, and each of them asks here first.
 *
 * PURE AND IMPORT-FREE, so the client components that draw the controls and
 * the server actions that refuse the press call the same predicate — the rule
 * the permission-gate sweep of 2026-09-04 settled on (packs-and-profiles.md):
 * one predicate, both sides. A control drawn but refused, or refused but
 * drawn, is the bug that sweep was fixing.
 */

/** The acts the console refuses on the operator row, each with its sentence. */
export const OPERATOR_REFUSALS = {
  /** The status select: the script sets `active`, and it stays so. */
  status:
    "This is the operator tenant. Its status is not changed from the console.",
  /** Switching a feature OFF: the platform will depend on these being on. */
  moduleOff:
    "This is the operator tenant. Its features stay switched on — the platform depends on them.",
  /** An allotment, a timer, a logged hour: a retainer with itself. */
  retainer:
    "This is the operator tenant. It cannot hold a retainer with itself.",
  /** A plan, a checkout, an hour block: billed by itself. */
  billing: "This is the operator tenant. It is not billed by itself.",
  /** A support view: the superadmin is already a member of it. */
  support:
    "This is the operator tenant. Open it from the organization switcher, not as support.",
} as const;

export type OperatorAct = keyof typeof OPERATOR_REFUSALS;

/**
 * The sentence the console must show, or null when the act is allowed —
 * which it always is for every tenant but one.
 */
export function operatorRefusal(
  tenant: { isOperator: boolean },
  act: OperatorAct,
): string | null {
  return tenant.isOperator ? OPERATOR_REFUSALS[act] : null;
}
