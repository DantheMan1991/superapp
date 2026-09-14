"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  deletePayApplicationAction,
  issuePayApplicationAction,
  updatePayApplicationAction,
} from "../actions";
import {
  costPlusTotals,
  percentStringToPpm,
  ppmToPercentString,
  type CostPlusTerms,
} from "../billing-math";

/** Today as the `date` input wants it, in the person's own timezone. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toCents(input: string): number {
  const n = Number(input.replace(/[,\s$]/g, ""));
  return Number.isFinite(n) && input.trim() !== "" ? Math.round(n * 100) : 0;
}

function money(c: number, symbol: string | null): string {
  const abs = `${symbol ?? ""}${(Math.abs(c) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return c < 0 ? `−${abs}` : abs;
}

export interface EditableCostLine {
  costCodeId: string | null;
  label: string;
  ledgerToDateCents: number;
  previousCents: number;
  thisPeriodCents: number;
}

export interface EditableCostPlusApplication {
  id: string;
  version: number;
  number: number;
  periodTo: string;
  retainagePpm: number;
  notes: string;
  /** The fixed fee billed to date, as saved on the draft. */
  feeToDateCents: number;
  previousCertificatesCents: number;
  costs: EditableCostLine[];
}

/**
 * A cost-plus draft: what the books carry on the job, what this application
 * bills of it, and the fee — the same five bottom lines as the G702 with
 * "cost plus fee to date" where "completed and stored" would be (ADR 0060).
 *
 * THE LEDGER IS THE SCHEDULE OF VALUES. There is nothing to type per line but
 * what to bill this period, which defaults to what the books added since the
 * last application; typing less leaves a bill out, typing less than nothing
 * passes a credit on. Saving refreshes the ledger figures for the period end
 * and keeps whatever was typed.
 */
export function CostPlusApplicationEditor({
  projectId,
  contractId,
  terms,
  app,
  symbol,
  trigger,
}: {
  projectId: string;
  contractId: string;
  terms: CostPlusTerms;
  app: EditableCostPlusApplication;
  symbol: string | null;
  trigger?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [periodTo, setPeriodTo] = useState(app.periodTo);
  const [retainage, setRetainage] = useState(ppmToPercentString(app.retainagePpm));
  const [feeToDate, setFeeToDate] = useState(
    app.feeToDateCents === 0 ? "" : (app.feeToDateCents / 100).toFixed(2),
  );
  const [notes, setNotes] = useState(app.notes);
  const [issueDate, setIssueDate] = useState(today());
  const [rows, setRows] = useState(() =>
    app.costs.map((c) => ({
      ...c,
      thisPeriod: c.thisPeriodCents === 0 ? "" : (c.thisPeriodCents / 100).toFixed(2),
    })),
  );

  const ppm = percentStringToPpm(retainage) ?? 0;
  const totals = useMemo(
    () =>
      costPlusTotals(
        rows.map((r) => ({
          costCodeId: r.costCodeId,
          ledgerToDateCents: r.ledgerToDateCents,
          previousCents: r.previousCents,
          thisPeriodCents: toCents(r.thisPeriod),
        })),
        terms,
        toCents(feeToDate),
        ppm,
        app.previousCertificatesCents,
      ),
    [rows, terms, feeToDate, ppm, app.previousCertificatesCents],
  );

  function setRow(i: number, thisPeriod: string) {
    setRows((prev) => prev.map((r, j) => (i === j ? { ...r, thisPeriod } : r)));
  }

  const payload = () => ({
    id: app.id,
    projectId,
    contractId,
    periodTo,
    retainagePercent: retainage,
    notes: notes.trim(),
    costLines: rows.map((r) => ({ costCodeId: r.costCodeId, thisPeriodCents: r.thisPeriod })),
    feeToDateCents: terms.feeCents ? feeToDate : "",
    version: app.version,
  });

  function save() {
    startTransition(async () => {
      const result = await updatePayApplicationAction(payload());
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Application saved");
      setOpen(false);
      router.refresh();
    });
  }

  function issue() {
    startTransition(async () => {
      // Save first, so the certificate is issued from what is on screen and
      // the version the issue carries is the one that save produced.
      const saved = await updatePayApplicationAction(payload());
      if ("error" in saved) {
        toast.error(saved.error);
        return;
      }
      const result = await issuePayApplicationAction({
        id: app.id,
        projectId,
        contractId,
        issueDate,
        version: app.version + 1,
      });
      if ("error" in result) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      toast.success(`Application ${app.number} issued as an invoice`);
      setOpen(false);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deletePayApplicationAction({ id: app.id, projectId, contractId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Draft deleted");
      setOpen(false);
      router.refresh();
    });
  }

  const feeLabel = [
    terms.feePpm ? `${ppmToPercentString(terms.feePpm)}% of cost` : null,
    terms.feeCents ? `fixed ${money(terms.feeCents, symbol)}` : null,
  ]
    .filter(Boolean)
    .join(" + ");

  return (
    <>
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <FileCheck className="mr-1.5 size-4" /> Open draft
          </Button>
        )}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Application {app.number} — draft, cost plus a fee</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="cpe-period">Period to</Label>
                <Input
                  id="cpe-period"
                  type="date"
                  value={periodTo}
                  onChange={(e) => setPeriodTo(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cpe-retainage">Retainage %</Label>
                <Input
                  id="cpe-retainage"
                  value={retainage}
                  onChange={(e) => setRetainage(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                />
              </div>
              {terms.feeCents ? (
                <div className="space-y-1.5">
                  <Label htmlFor="cpe-fee">Fixed fee billed to date</Label>
                  <Input
                    id="cpe-fee"
                    value={feeToDate}
                    onChange={(e) => setFeeToDate(e.target.value)}
                    inputMode="decimal"
                    placeholder={`of ${money(terms.feeCents, symbol)}`}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Fee</Label>
                  <p className="pt-2 text-sm text-muted-foreground">{feeLabel || "none"}</p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="cpe-issue">Issue on</Label>
                <Input
                  id="cpe-issue"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Cost code</th>
                    <th className="px-2 py-1.5 text-right">In the books to date</th>
                    <th className="px-2 py-1.5 text-right">Billed before</th>
                    <th className="px-2 py-1.5 text-right">This period</th>
                    <th className="px-2 py-1.5 text-right">Billed to date</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td className="px-2 py-3 text-muted-foreground" colSpan={5}>
                        The books carry no cost on this job as of the period end.
                        Save with a later date, or code a bill to the job first.
                      </td>
                    </tr>
                  )}
                  {rows.map((r, i) => {
                    const thisPeriod = toCents(r.thisPeriod);
                    const unbilled = r.ledgerToDateCents - r.previousCents - thisPeriod;
                    return (
                      <tr key={r.costCodeId ?? "none"} className="border-t border-border/50">
                        <td className="px-2 py-1">
                          {r.label}
                          {unbilled !== 0 && (
                            <span className="block text-xs text-muted-foreground">
                              {unbilled > 0
                                ? `${money(unbilled, symbol)} left unbilled`
                                : `${money(-unbilled, symbol)} beyond the books`}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {money(r.ledgerToDateCents, symbol)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                          {money(r.previousCents, symbol)}
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            aria-label={`This period, ${r.label}`}
                            value={r.thisPeriod}
                            onChange={(e) => setRow(i, e.target.value)}
                            placeholder="0.00"
                            inputMode="decimal"
                            className="h-8 w-28 text-right"
                          />
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {money(r.previousCents + thisPeriod, symbol)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/*
              THE CERTIFICATE, live from the same arithmetic the server writes at
              issue, so what the form promises is what the invoice says.
            */}
            <dl className="ml-auto grid max-w-sm gap-1 text-sm">
              {(
                [
                  ["Cost to date", totals.costToDateCents],
                  [`Fee to date${feeLabel ? ` (${feeLabel})` : ""}`, totals.feeToDateCents],
                  [
                    totals.capped ? "Cost plus fee, at the guaranteed maximum" : "Cost plus fee to date",
                    totals.completedToDateCents,
                  ],
                  [`Retainage (${retainage || "0"}%)`, -totals.retainageCents],
                  ["Earned less retainage", totals.earnedLessRetainageCents],
                  ["Less previous certificates", -totals.previousCertificatesCents],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums">{money(value, symbol)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-border/60 pt-1 font-medium">
                <dt>Current payment due</dt>
                <dd className={"tabular-nums " + (totals.dueCents <= 0 ? "text-destructive" : "")}>
                  {money(totals.dueCents, symbol)}
                </dd>
              </div>
              {terms.gmaxCents !== null && (
                <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                  <dt>Balance to the guaranteed maximum</dt>
                  <dd className="tabular-nums">{money(totals.balanceToFinishCents, symbol)}</dd>
                </div>
              )}
            </dl>

            <div className="space-y-1.5">
              <Label htmlFor="cpe-notes">Notes</Label>
              <Textarea
                id="cpe-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <Button variant="ghost" onClick={remove} disabled={pending}>
              Delete draft
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save draft"}
              </Button>
              <Button onClick={issue} disabled={pending || totals.dueCents <= 0}>
                {pending ? "Working…" : "Issue as invoice"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
