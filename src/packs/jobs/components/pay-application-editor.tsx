"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileCheck, Plus } from "lucide-react";
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
  createPayApplicationAction,
  deletePayApplicationAction,
  issuePayApplicationAction,
  updatePayApplicationAction,
  voidPayApplicationAction,
} from "../actions";
import {
  lineCompletedCents,
  payApplicationTotals,
  percentComplete,
  percentStringToPpm,
  ppmToPercentString,
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

/**
 * Start a draw: the period it covers and the retainage rate, carried from the
 * last application unless changed here. Everything else — what each line
 * completed — is the draft's own dialog.
 */
export function NewPayApplication({
  projectId,
  contractId,
  lastRetainagePpm,
  disabledReason,
}: {
  projectId: string;
  contractId: string;
  lastRetainagePpm: number | null;
  /** Why the button is greyed: no schedule yet, or a draft already open. */
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [periodTo, setPeriodTo] = useState(today());
  const [retainage, setRetainage] = useState(
    lastRetainagePpm === null ? "" : ppmToPercentString(lastRetainagePpm),
  );
  const [notes, setNotes] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await createPayApplicationAction({
        projectId,
        contractId,
        periodTo,
        retainagePercent: retainage,
        notes,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Application started");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabledReason !== null}
        title={disabledReason ?? undefined}
      >
        <Plus className="mr-1.5 size-4" /> New application
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New pay application</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pa-period">Period to</Label>
              <Input
                id="pa-period"
                type="date"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pa-retainage">Retainage %</Label>
              <Input
                id="pa-retainage"
                value={retainage}
                onChange={(e) => setRetainage(e.target.value)}
                placeholder="0"
                inputMode="decimal"
              />
              <p className="text-xs text-muted-foreground">
                Held back from everything completed to date, released when a
                later application lowers it. Blank is none.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pa-notes">Notes</Label>
              <Textarea
                id="pa-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || periodTo === ""}>
              {pending ? "Starting…" : "Start application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export interface EditableApplication {
  id: string;
  version: number;
  number: number;
  periodTo: string;
  retainagePpm: number;
  notes: string;
  previousCertificatesCents: number;
  lines: Array<{
    sovLineId: string;
    description: string;
    scheduledCents: number;
    previousCents: number;
    thisPeriodCents: number;
    storedCents: number;
  }>;
}

/**
 * The G703, as a form: one row per schedule line with what was completed on
 * earlier applications (carried, not typed), what was completed THIS period
 * (typed, may be negative to correct an earlier over-billing), and what is
 * stored on site; the G702 totals underneath, live, from the same arithmetic
 * the server will write.
 *
 * SAVE keeps the draft. ISSUE freezes it and posts it as an invoice, dated
 * the day in the box; from then on it is a certificate somebody has, and it
 * is voided rather than edited.
 */
export function PayApplicationEditor({
  projectId,
  contractId,
  app,
  symbol,
  trigger,
}: {
  projectId: string;
  contractId: string;
  app: EditableApplication;
  symbol: string | null;
  trigger?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [periodTo, setPeriodTo] = useState(app.periodTo);
  const [retainage, setRetainage] = useState(ppmToPercentString(app.retainagePpm));
  const [notes, setNotes] = useState(app.notes);
  const [issueDate, setIssueDate] = useState(today());
  const [rows, setRows] = useState(() =>
    app.lines.map((l) => ({
      ...l,
      thisPeriod: l.thisPeriodCents === 0 ? "" : (l.thisPeriodCents / 100).toFixed(2),
      stored: l.storedCents === 0 ? "" : (l.storedCents / 100).toFixed(2),
    })),
  );

  const ppm = percentStringToPpm(retainage) ?? 0;
  const totals = useMemo(
    () =>
      payApplicationTotals(
        rows.map((r) => ({
          sovLineId: r.sovLineId,
          scheduledCents: r.scheduledCents,
          previousCents: r.previousCents,
          thisPeriodCents: toCents(r.thisPeriod),
          storedCents: toCents(r.stored),
        })),
        ppm,
        app.previousCertificatesCents,
      ),
    [rows, ppm, app.previousCertificatesCents],
  );

  function setRow(i: number, patch: Partial<{ thisPeriod: string; stored: string }>) {
    setRows((prev) => prev.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  }

  const payload = () => ({
    id: app.id,
    projectId,
    contractId,
    periodTo,
    retainagePercent: retainage,
    notes: notes.trim(),
    lines: rows.map((r) => ({
      sovLineId: r.sovLineId,
      thisPeriodCents: r.thisPeriod,
      storedCents: r.stored,
    })),
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
            <DialogTitle>Application {app.number} — draft</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pae-period">Period to</Label>
                <Input
                  id="pae-period"
                  type="date"
                  value={periodTo}
                  onChange={(e) => setPeriodTo(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pae-retainage">Retainage %</Label>
                <Input
                  id="pae-retainage"
                  value={retainage}
                  onChange={(e) => setRetainage(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pae-issue">Issue on</Label>
                <Input
                  id="pae-issue"
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
                    <th className="px-2 py-1.5 text-left">Line</th>
                    <th className="px-2 py-1.5 text-right">Scheduled</th>
                    <th className="px-2 py-1.5 text-right">Previous</th>
                    <th className="px-2 py-1.5 text-right">This period</th>
                    <th className="px-2 py-1.5 text-right">Stored</th>
                    <th className="px-2 py-1.5 text-right">To date</th>
                    <th className="px-2 py-1.5 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const completed = lineCompletedCents({
                      previousCents: r.previousCents,
                      thisPeriodCents: toCents(r.thisPeriod),
                      storedCents: toCents(r.stored),
                    });
                    const pct = percentComplete(completed, r.scheduledCents);
                    return (
                      <tr key={r.sovLineId} className="border-t border-border/50">
                        <td className="px-2 py-1">{r.description}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {money(r.scheduledCents, symbol)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                          {money(r.previousCents, symbol)}
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            aria-label={`This period, ${r.description}`}
                            value={r.thisPeriod}
                            onChange={(e) => setRow(i, { thisPeriod: e.target.value })}
                            placeholder="0.00"
                            inputMode="decimal"
                            className="h-8 w-28 text-right"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            aria-label={`Stored, ${r.description}`}
                            value={r.stored}
                            onChange={(e) => setRow(i, { stored: e.target.value })}
                            placeholder="0.00"
                            inputMode="decimal"
                            className="h-8 w-24 text-right"
                          />
                        </td>
                        <td
                          className={
                            "px-2 py-1 text-right tabular-nums " +
                            (completed < 0 ? "text-destructive" : "")
                          }
                        >
                          {money(completed, symbol)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                          {pct === null ? "—" : `${pct}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/*
              THE G702, live from the same arithmetic the server writes at
              issue, so what the form promises is what the invoice says.
            */}
            <dl className="ml-auto grid max-w-sm gap-1 text-sm">
              {(
                [
                  ["Completed and stored to date", totals.completedToDateCents],
                  [`Retainage (${retainage || "0"}%)`, -totals.retainageCents],
                  ["Total earned less retainage", totals.earnedLessRetainageCents],
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
              <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                <dt>Balance to finish</dt>
                <dd className="tabular-nums">{money(totals.balanceToFinishCents, symbol)}</dd>
              </div>
            </dl>

            <div className="space-y-1.5">
              <Label htmlFor="pae-notes">Notes</Label>
              <Textarea
                id="pae-notes"
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

/** Void the latest issued application; Accounting voids its invoice. */
export function VoidPayApplicationButton({
  projectId,
  contractId,
  id,
  number,
  version,
}: {
  projectId: string;
  contractId: string;
  id: string;
  number: number;
  version: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Void application ${number}? Its invoice is voided too.`)) return;
        startTransition(async () => {
          const result = await voidPayApplicationAction({ id, projectId, contractId, version });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(`Application ${number} voided`);
          router.refresh();
        });
      }}
    >
      Void
    </Button>
  );
}
