import "server-only";
import { notFound } from "next/navigation";
import type { Tx } from "@/db";
import { LedgerError, resolveReportEntity } from "../core";

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
 * Lives here rather than in `core/` because `notFound()` is a Next concern and
 * the core engine is called from tests and from the cron routes too.
 */
export async function reportEntityOr404(
  tx: Tx,
  tenantId: string,
  requested: string | undefined,
): ReturnType<typeof resolveReportEntity> {
  try {
    return await resolveReportEntity(tx, tenantId, requested);
  } catch (err) {
    if (err instanceof LedgerError && err.code === "ENTITY_NOT_FOUND") {
      notFound();
    }
    throw err;
  }
}
