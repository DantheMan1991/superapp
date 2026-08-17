import "server-only";
import { notFound } from "next/navigation";
import type { Tx } from "@/db";
import {
  LedgerError,
  resolveReportEntity,
  type EntityScope,
  type FilterScope,
  type ReportEntityView,
} from "../core";

/**
 * `resolveReportEntity` for a report PAGE: an `entity` in the query string that
 * this tenant does not own becomes a 404.
 *
 * The refusal is the point (ADR 0010) — substituting the default company, or
 * everything, would answer a question about different books while looking
 * entirely normal. A 404 is how it refuses without a 500 on a query string
 * somebody can type, which is the same objection the P&L's month-range error
 * already answers.
 *
 * `?entity=consolidated` ON A REPORT THAT DECLINES ONE 404s BY THE SAME RULE
 * (slice 3): a scope this report does not have is refused rather than quietly
 * answered with the combined figures under the name the reader chose for the
 * difference between them.
 *
 * The `consolidation` argument decides the TYPE of the scope that comes back,
 * so a declining page type-checks against `entityScopeCondition` and an
 * offering one can only reach the ledger through `ledgerScopeConditions`.
 *
 * Lives here rather than in `core/` because `notFound()` is a Next concern and
 * the core engine is called from tests and from the cron routes too.
 */
export async function reportEntityOr404(
  tx: Tx,
  tenantId: string,
  requested: string | undefined,
  consolidation: "offered",
): Promise<ReportEntityView<EntityScope>>;
export async function reportEntityOr404(
  tx: Tx,
  tenantId: string,
  requested: string | undefined,
  consolidation: "declined",
): Promise<ReportEntityView<FilterScope>>;
export async function reportEntityOr404(
  tx: Tx,
  tenantId: string,
  requested: string | undefined,
  consolidation: "offered" | "declined",
): Promise<ReportEntityView> {
  try {
    return consolidation === "offered"
      ? await resolveReportEntity(tx, tenantId, requested, "offered")
      : await resolveReportEntity(tx, tenantId, requested, "declined");
  } catch (err) {
    if (
      err instanceof LedgerError &&
      (err.code === "ENTITY_NOT_FOUND" || err.code === "SCOPE_NOT_OFFERED")
    ) {
      notFound();
    }
    throw err;
  }
}
