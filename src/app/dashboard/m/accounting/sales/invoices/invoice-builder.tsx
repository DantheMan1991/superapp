"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createInvoiceDraftAction,
  updateInvoiceDraftAction,
} from "@/modules/accounting/invoicing/actions";
import {
  lineAmountCents,
  parseQuantityHundredths,
} from "@/modules/accounting/invoicing/lines";
import {
  formatCentsSigned,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";

export interface BuilderCustomer {
  id: string;
  name: string;
}

export interface BuilderAccount {
  id: string;
  code: string;
  name: string;
}

interface LineRow {
  key: string;
  description: string;
  quantity: string;
  /** Raw money string; sign toggle below. */
  unitPrice: string;
  discount: boolean;
  incomeAccountId: string;
}

export interface BuilderInvoice {
  id: string;
  version: number;
  customerId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  memo: string;
  lines: Array<{
    description: string;
    quantity: string;
    unitPriceCents: number;
    incomeAccountId: string;
  }>;
}

function emptyRow(defaultAccount: string): LineRow {
  return {
    key: crypto.randomUUID(),
    description: "",
    quantity: "1",
    unitPrice: "",
    discount: false,
    incomeAccountId: defaultAccount,
  };
}

export function InvoiceBuilder({
  customers,
  incomeAccounts,
  suggestedNumber,
  today,
  invoice,
}: {
  customers: BuilderCustomer[];
  incomeAccounts: BuilderAccount[];
  suggestedNumber: string;
  today: string;
  /** When set, edits this draft instead of creating. */
  invoice?: BuilderInvoice;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const defaultAccount = incomeAccounts[0]?.id ?? "";
  const [customerId, setCustomerId] = useState(invoice?.customerId ?? "");
  const [number, setNumber] = useState(invoice?.invoiceNumber ?? suggestedNumber);
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? today);
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? "");
  const [memo, setMemo] = useState(invoice?.memo ?? "");
  const [rows, setRows] = useState<LineRow[]>(
    invoice
      ? invoice.lines.map((l) => ({
          key: crypto.randomUUID(),
          description: l.description,
          quantity: l.quantity,
          unitPrice: (Math.abs(l.unitPriceCents) / 100).toFixed(2),
          discount: l.unitPriceCents < 0,
          incomeAccountId: l.incomeAccountId,
        }))
      : [emptyRow(defaultAccount)],
  );

  const parsed = rows.map((row) => {
    const qty = parseQuantityHundredths(row.quantity);
    const price = parseMoneyToCents(row.unitPrice);
    const priceCents = price === null ? null : row.discount ? -price : price;
    const valid = qty !== null && priceCents !== null && row.incomeAccountId !== "";
    return {
      row,
      valid,
      amountCents: valid ? lineAmountCents(qty!, priceCents!) : 0,
    };
  });
  const filled = parsed.filter(
    (p) => p.row.description.trim() !== "" || p.row.unitPrice.trim() !== "",
  );
  const allValid = filled.length > 0 && filled.every((p) => p.valid);
  const totalCents = useMemo(
    () => filled.reduce((s, p) => s + p.amountCents, 0),
    [filled],
  );

  function setRow(key: string, patch: Partial<LineRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function submit() {
    const lines = filled.map((p) => {
      const price = parseMoneyToCents(p.row.unitPrice)!;
      return {
        description: p.row.description.trim(),
        quantity: p.row.quantity,
        unitPriceCents: p.row.discount ? -price : price,
        incomeAccountId: p.row.incomeAccountId,
      };
    });
    startTransition(async () => {
      const payload = {
        customerId,
        invoiceNumber: number.trim() || undefined,
        issueDate,
        dueDate: dueDate || null,
        memo: memo.trim() || undefined,
        lines,
      };
      const result = invoice
        ? await updateInvoiceDraftAction({
            invoiceId: invoice.id,
            expectedVersion: invoice.version,
            patch: payload,
          })
        : await createInvoiceDraftAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(invoice ? "Draft updated" : "Draft saved");
      const id = invoice
        ? invoice.id
        : (result as { data?: { invoiceId: string } }).data!.invoiceId;
      router.push(`/dashboard/m/accounting/sales/invoices/${id}`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Customer</Label>
            <Select value={customerId || undefined} onValueChange={setCustomerId}>
              <SelectTrigger>
                <SelectValue placeholder="Select customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-number">Number</Label>
            <Input
              id="inv-number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-issue">Issue date</Label>
            <Input
              id="inv-issue"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="inv-due">Due date (optional)</Label>
            <Input
              id="inv-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="inv-memo">Memo</Label>
            <Input
              id="inv-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Shown on the printed invoice"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[640px] space-y-2">
            <div className="grid grid-cols-[1fr_90px_120px_60px_1fr_100px_32px] items-center gap-2 text-xs font-medium text-muted-foreground">
              <span>Description</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit price</span>
              <span>Disc.</span>
              <span>Income account</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            {rows.map((row) => {
              const p = parsed.find((x) => x.row.key === row.key)!;
              return (
                <div
                  key={row.key}
                  className="grid grid-cols-[1fr_90px_120px_60px_1fr_100px_32px] items-center gap-2"
                >
                  <Input
                    className="h-9"
                    value={row.description}
                    placeholder="What was provided"
                    onChange={(e) => setRow(row.key, { description: e.target.value })}
                  />
                  <Input
                    inputMode="decimal"
                    className="h-9 text-right font-mono"
                    value={row.quantity}
                    onChange={(e) => setRow(row.key, { quantity: e.target.value })}
                  />
                  <Input
                    inputMode="decimal"
                    className="h-9 text-right font-mono"
                    placeholder="0.00"
                    value={row.unitPrice}
                    onChange={(e) => setRow(row.key, { unitPrice: e.target.value })}
                  />
                  <label className="flex justify-center">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={row.discount}
                      title="Discount line (negative)"
                      onChange={(e) => setRow(row.key, { discount: e.target.checked })}
                    />
                  </label>
                  <Select
                    value={row.incomeAccountId || undefined}
                    onValueChange={(v) => setRow(row.key, { incomeAccountId: v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Account" />
                    </SelectTrigger>
                    <SelectContent>
                      {incomeAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-right font-mono text-sm">
                    {p.valid ? formatCentsSigned(p.amountCents) : "—"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    disabled={rows.length <= 1}
                    onClick={() =>
                      setRows((rs) => rs.filter((r) => r.key !== row.key))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows((rs) => [...rs, emptyRow(defaultAccount)])}
        >
          <Plus className="mr-1.5 size-4" /> Add line
        </Button>

        <div className="flex items-center justify-between border-t pt-4">
          <p className="font-mono text-lg font-semibold">
            Total {formatCentsSigned(totalCents)}
          </p>
          <Button
            onClick={submit}
            disabled={pending || !customerId || !allValid || !issueDate}
          >
            {pending ? "Saving…" : invoice ? "Save changes" : "Save draft"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
