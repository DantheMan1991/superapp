"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
  createBillDraftAction,
  createVendorAction,
  updateBillDraftAction,
} from "@/modules/accounting/payables/actions";
import {
  formatCentsSigned,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";

export interface BuilderVendor {
  id: string;
  name: string;
}

export interface BuilderAccount {
  id: string;
  code: string;
  name: string;
}

export interface BuilderSuggestion {
  billLineId: string;
  accountId: string;
  accountCode: string;
  confidence: number;
  reason?: string;
}

interface LineRow {
  key: string;
  /** Existing line id when editing — carries the AI suggestion. */
  billLineId: string | null;
  description: string;
  /** Raw money string; credit toggle below. */
  amount: string;
  credit: boolean;
  accountId: string;
}

export interface BuilderBill {
  id: string;
  version: number;
  vendorId: string;
  billNumber: string;
  billDate: string;
  dueDate: string | null;
  memo: string;
  lines: Array<{
    id: string;
    description: string;
    amountCents: number;
    accountId: string | null;
  }>;
  suggestions: BuilderSuggestion[];
}

interface DuplicateWarning {
  billId: string;
  billNumber: string;
  billDate: string;
  reason: string;
}

function emptyRow(): LineRow {
  return {
    key: crypto.randomUUID(),
    billLineId: null,
    description: "",
    amount: "",
    credit: false,
    accountId: "",
  };
}

export function BillBuilder({
  vendors,
  accounts,
  today,
  bill,
  initialDuplicates,
}: {
  vendors: BuilderVendor[];
  accounts: BuilderAccount[];
  today: string;
  /** When set, edits this draft instead of creating. */
  bill?: BuilderBill;
  initialDuplicates?: DuplicateWarning[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [vendorList, setVendorList] = useState(vendors);
  const [vendorId, setVendorId] = useState(bill?.vendorId ?? "");
  const [newVendorName, setNewVendorName] = useState("");
  const [number, setNumber] = useState(bill?.billNumber ?? "");
  const [billDate, setBillDate] = useState(bill?.billDate ?? today);
  const [dueDate, setDueDate] = useState(bill?.dueDate ?? "");
  const [memo, setMemo] = useState(bill?.memo ?? "");
  const [duplicates, setDuplicates] = useState<DuplicateWarning[]>(
    initialDuplicates ?? [],
  );
  const [rows, setRows] = useState<LineRow[]>(
    bill
      ? bill.lines.map((l) => ({
          key: crypto.randomUUID(),
          billLineId: l.id,
          description: l.description,
          amount: l.amountCents === 0 ? "" : (Math.abs(l.amountCents) / 100).toFixed(2),
          credit: l.amountCents < 0,
          accountId: l.accountId ?? "",
        }))
      : [emptyRow()],
  );

  const suggestionFor = (row: LineRow): BuilderSuggestion | undefined =>
    row.billLineId
      ? bill?.suggestions.find(
          (s) => s.billLineId === row.billLineId && s.confidence >= 0.5,
        )
      : undefined;

  const parsed = rows.map((row) => {
    const cents = parseMoneyToCents(row.amount);
    const signed = cents === null ? null : row.credit ? -cents : cents;
    return { row, valid: signed !== null, amountCents: signed ?? 0 };
  });
  const filled = parsed.filter(
    (p) => p.row.description.trim() !== "" || p.row.amount.trim() !== "",
  );
  const allValid = filled.length > 0 && filled.every((p) => p.valid);
  const totalCents = useMemo(
    () => filled.reduce((s, p) => s + p.amountCents, 0),
    [filled],
  );

  function setRow(key: string, patch: Partial<LineRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function applyAllSuggestions() {
    setRows((rs) =>
      rs.map((r) => {
        const s = suggestionFor(r);
        return s && s.confidence >= 0.7 && r.accountId === ""
          ? { ...r, accountId: s.accountId }
          : r;
      }),
    );
  }

  function submit() {
    startTransition(async () => {
      let resolvedVendorId = vendorId;
      if (!resolvedVendorId && newVendorName.trim()) {
        const created = await createVendorAction({ name: newVendorName.trim() });
        if ("error" in created) {
          toast.error(created.error);
          return;
        }
        resolvedVendorId = created.data!.vendorId;
      }
      if (!resolvedVendorId) {
        toast.error("Pick or create a vendor.");
        return;
      }
      const lines = filled.map((p) => ({
        description: p.row.description.trim(),
        amountCents: p.amountCents,
        accountId: p.row.accountId || null,
      }));
      const payload = {
        vendorId: resolvedVendorId,
        billNumber: number.trim() || undefined,
        billDate,
        dueDate: dueDate || null,
        memo: memo.trim() || undefined,
        lines,
      };
      const result = bill
        ? await updateBillDraftAction({
            billId: bill.id,
            expectedVersion: bill.version,
            patch: payload,
          })
        : await createBillDraftAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const dups =
        (result as { data?: { duplicates?: DuplicateWarning[] } }).data
          ?.duplicates ?? [];
      setDuplicates(dups);
      if (dups.length > 0) {
        toast.warning("Saved — this may be a duplicate of an existing bill.");
      } else {
        toast.success(bill ? "Draft updated" : "Draft saved");
      }
      const id = bill
        ? bill.id
        : (result as { data?: { billId: string } }).data!.billId;
      router.push(`/dashboard/m/accounting/purchases/bills/${id}`);
      router.refresh();
    });
  }

  const uncodedCount = filled.filter((p) => p.row.accountId === "").length;
  const hasSuggestions = rows.some((r) => suggestionFor(r));

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {duplicates.length > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Possible duplicate: this vendor already has{" "}
              {duplicates
                .map((d) => `${d.billNumber || "a bill"} (${d.billDate})`)
                .join(", ")}
              . Nothing is blocked — just double-check before approving.
            </span>
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Vendor</Label>
            <Select
              value={vendorId || undefined}
              onValueChange={(v) => {
                setVendorId(v);
                setNewVendorName("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select vendor" />
              </SelectTrigger>
              <SelectContent>
                {vendorList.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!bill && (
              <Input
                className="h-8"
                placeholder="…or type a new vendor name"
                value={newVendorName}
                onChange={(e) => {
                  setNewVendorName(e.target.value);
                  if (e.target.value) setVendorId("");
                }}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bill-number">Vendor invoice #</Label>
            <Input
              id="bill-number"
              value={number}
              placeholder="As printed on the bill"
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bill-date">Bill date</Label>
            <Input
              id="bill-date"
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="bill-due">Due date (optional)</Label>
            <Input
              id="bill-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="bill-memo">Memo</Label>
            <Input
              id="bill-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[640px] space-y-2">
            <div className="grid grid-cols-[1fr_130px_60px_1fr_32px] items-center gap-2 text-xs font-medium text-muted-foreground">
              <span>Description</span>
              <span className="text-right">Amount</span>
              <span>Credit</span>
              <span>Account</span>
              <span />
            </div>
            {rows.map((row) => {
              const suggestion = suggestionFor(row);
              return (
                <div key={row.key} className="space-y-1">
                  <div className="grid grid-cols-[1fr_130px_60px_1fr_32px] items-center gap-2">
                    <Input
                      className="h-9"
                      value={row.description}
                      placeholder="What was billed"
                      onChange={(e) =>
                        setRow(row.key, { description: e.target.value })
                      }
                    />
                    <Input
                      inputMode="decimal"
                      className="h-9 text-right font-mono"
                      placeholder="0.00"
                      value={row.amount}
                      onChange={(e) => setRow(row.key, { amount: e.target.value })}
                    />
                    <label className="flex justify-center">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={row.credit}
                        title="Credit/discount line (negative)"
                        onChange={(e) => setRow(row.key, { credit: e.target.checked })}
                      />
                    </label>
                    <Select
                      value={row.accountId || undefined}
                      onValueChange={(v) => setRow(row.key, { accountId: v })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Uncoded" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.code} · {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                  {suggestion && row.accountId !== suggestion.accountId && (
                    <button
                      type="button"
                      className={cn(
                        "ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                        suggestion.confidence >= 0.7
                          ? "bg-brand/10 text-brand"
                          : "bg-muted text-muted-foreground",
                      )}
                      title={suggestion.reason}
                      onClick={() => setRow(row.key, { accountId: suggestion.accountId })}
                    >
                      <Sparkles className="size-3" />
                      Use {suggestion.accountCode} ·{" "}
                      {Math.round(suggestion.confidence * 100)}%
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((rs) => [...rs, emptyRow()])}
          >
            <Plus className="mr-1.5 size-4" /> Add line
          </Button>
          {hasSuggestions && (
            <Button type="button" variant="outline" size="sm" onClick={applyAllSuggestions}>
              <Sparkles className="mr-1.5 size-4" /> Use all suggestions ≥ 70%
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <div>
            <p className="font-mono text-lg font-semibold">
              Total {formatCentsSigned(totalCents)}
            </p>
            {uncodedCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {uncodedCount} uncoded line{uncodedCount === 1 ? "" : "s"} — fine
                for a draft; approval requires accounts on every line.
              </p>
            )}
          </div>
          <Button
            onClick={submit}
            disabled={pending || (!vendorId && !newVendorName.trim()) || !allValid || !billDate}
          >
            {pending ? "Saving…" : bill ? "Save changes" : "Save draft"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
