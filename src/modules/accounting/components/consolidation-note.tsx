import { residualNote, type ConsolidationResidual } from "../core";

/**
 * What a consolidated statement could NOT eliminate, said on the face of the
 * report (ADR 0010 slice 3).
 *
 * SURFACED RATHER THAN RECONCILED AWAY, the way the tax summary shows the gap
 * between the invoices and the ledger instead of closing it. A manual journal
 * into an affiliate account has no link to follow, so consolidation leaves the
 * balance standing — and it has no counterparty leg to remove with it either,
 * so hiding the line would leave assets short against liabilities-plus-equity
 * and require inventing an equity plug to cover the difference. A fabricated
 * number to make a statement look tidy is the one thing this module never does.
 *
 * Renders nothing at all when there is nothing to say, so the ordinary
 * consolidated report — every intercompany transfer recorded as a pair — is
 * clean.
 */
export function ConsolidationNote({
  residual,
}: {
  residual: ConsolidationResidual | null;
}) {
  if (!residual) return null;
  return (
    <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
      {residualNote(residual)}{" "}
      <span className="text-muted-foreground">
        Record money moving between your companies as a transfer, so both sides
        are linked and consolidation can follow them.
      </span>
    </p>
  );
}
