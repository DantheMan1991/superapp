"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  cancelReconciliationAction,
  completeReconciliationAction,
  reopenReconciliationAction,
  startReconciliationAction,
  toggleReconciliationLineAction,
} from "@/modules/accounting/banking/actions";
import {
  formatCentsSigned,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";

export function StartReconciliationForm({
  bankAccountId,
  kind,
}: {
  bankAccountId: string;
  kind: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState("");
  const [balance, setBalance] = useState("");
  const [negative, setNegative] = useState(false);

  function submit() {
    const cents = parseMoneyToCents(balance);
    if (cents === null) {
      toast.error("Enter the statement ending balance");
      return;
    }
    startTransition(async () => {
      const result = await startReconciliationAction({
        bankAccountId,
        statementEndDate: date,
        statementEndBalanceCents: negative ? -cents : cents,
      });
      if ("error" in result) toast.error(result.error);
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Start a reconciliation</CardTitle>
        <CardDescription>
          From the top of your bank statement.
          {kind === "credit_card" &&
            " For credit cards, enter the balance as printed (positive = amount owed)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rec-date">Statement end date</Label>
          <Input
            id="rec-date"
            type="date"
            className="h-9"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rec-bal">Statement ending balance</Label>
          <Input
            id="rec-bal"
            inputMode="decimal"
            placeholder="0.00"
            className="h-9 w-40 text-right font-mono"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={negative}
            onChange={(e) => setNegative(e.target.checked)}
          />
          Negative balance
        </label>
        <Button onClick={submit} disabled={pending || !date || !balance}>
          {pending ? "Starting…" : "Start"}
        </Button>
      </CardContent>
    </Card>
  );
}

interface WorkbenchView {
  reconciliationId: string;
  version: number;
  statementEndDate: string;
  statementEndBalanceCents: number;
  kind: string;
  candidates: Array<{
    journalLineId: string;
    entryId: string;
    entryDate: string;
    entryMemo: string;
    lineMemo: string;
    amountCents: number;
    checked: boolean;
  }>;
  priorReconciledCents: number;
  checkedCents: number;
  expectedLedgerCents: number;
  differenceCents: number;
}

export function ReconcileWorkbench({ view }: { view: WorkbenchView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyLine, setBusyLine] = useState<string | null>(null);

  function toggle(journalLineId: string, checked: boolean) {
    setBusyLine(journalLineId);
    startTransition(async () => {
      const result = await toggleReconciliationLineAction({
        reconciliationId: view.reconciliationId,
        journalLineId,
        checked,
      });
      if ("error" in result) toast.error(result.error);
      setBusyLine(null);
      router.refresh();
    });
  }

  function complete() {
    startTransition(async () => {
      const result = await completeReconciliationAction({
        reconciliationId: view.reconciliationId,
        expectedVersion: view.version,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Reconciled — statement matched");
        router.refresh();
      }
    });
  }

  function cancel() {
    if (!window.confirm("Cancel this reconciliation? Checked lines are released.")) return;
    startTransition(async () => {
      const result = await cancelReconciliationAction({
        reconciliationId: view.reconciliationId,
        expectedVersion: view.version,
      });
      if ("error" in result) toast.error(result.error);
      else router.refresh();
    });
  }

  const balanced = view.differenceCents === 0;

  return (
    <div className="space-y-4">
      <Card className="sticky top-14 z-10 lg:top-0">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">
                Statement ({view.statementEndDate})
              </p>
              <p className="font-mono font-semibold">
                {formatCentsSigned(view.statementEndBalanceCents)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cleared (prior + checked)</p>
              <p className="font-mono font-semibold">
                {formatCentsSigned(view.priorReconciledCents + view.checkedCents)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Difference</p>
              <p
                className={`font-mono font-semibold ${balanced ? "text-emerald-600" : "text-destructive"}`}
              >
                {formatCentsSigned(view.differenceCents)}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={complete} disabled={pending || !balanced}>
              {pending ? "Working…" : "Complete"}
            </Button>
            <Button variant="outline" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {view.candidates.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No uncleared activity on this account through {view.statementEndDate}.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Date</TableHead>
                  <TableHead>Memo</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.candidates.map((c) => (
                  <TableRow key={c.journalLineId}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={c.checked}
                        disabled={pending && busyLine === c.journalLineId}
                        onChange={(e) => toggle(c.journalLineId, e.target.checked)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {c.entryDate}
                    </TableCell>
                    <TableCell className="max-w-[320px]">
                      <span className="block truncate text-sm">
                        {c.entryMemo || c.lineMemo || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {c.amountCents > 0 ? formatCentsSigned(c.amountCents) : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {c.amountCents < 0 ? formatCentsSigned(-c.amountCents) : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ReconciliationHistory({
  reconciliationId,
  version,
  canReopen,
}: {
  reconciliationId: string;
  version: number;
  canReopen: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function reopen() {
    if (!window.confirm("Reopen this reconciliation? Its cleared lines stay checked until you uncheck them.")) {
      return;
    }
    startTransition(async () => {
      const result = await reopenReconciliationAction({
        reconciliationId,
        expectedVersion: version,
      });
      if ("error" in result) toast.error(result.error);
      else router.refresh();
    });
  }

  if (!canReopen) return <Badge variant="secondary">completed</Badge>;
  return (
    <Button size="sm" variant="outline" onClick={reopen} disabled={pending}>
      {pending ? "Reopening…" : "Reopen"}
    </Button>
  );
}
