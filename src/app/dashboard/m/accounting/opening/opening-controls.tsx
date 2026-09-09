"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  recordOpeningBillAction,
  recordOpeningInvoiceAction,
} from "@/modules/accounting/opening/actions";

interface Option {
  id: string;
  name?: string;
  label?: string;
}

/** The day before a date, for the date input's ceiling. */
function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * One dialog for both kinds of opening document (ADR 0037). The words differ;
 * the shape does not: who, the number, the document's own date (before the
 * books began), when it was due, what was still owed, and the account the
 * cash basis will recognise it under when the money moves.
 */
export function OpeningDocumentDialog({
  kind,
  entityId,
  booksStartOn,
  parties,
  accounts,
}: {
  kind: "invoice" | "bill";
  entityId: string;
  booksStartOn: string | null;
  parties: Option[];
  accounts: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [partyId, setPartyId] = useState("");
  const [number, setNumber] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [memo, setMemo] = useState("");

  const invoice = kind === "invoice";
  const noun = invoice ? "invoice" : "bill";
  const partyWord = invoice ? "Customer" : "Vendor";
  const ceiling = booksStartOn ? dayBefore(booksStartOn) : undefined;
  const amountCents = Math.round(Number(amount) * 100);
  const ready =
    partyId !== "" &&
    documentDate !== "" &&
    (!booksStartOn || documentDate < booksStartOn) &&
    Number.isFinite(amountCents) &&
    amountCents > 0 &&
    accountId !== "";

  function reset() {
    setPartyId("");
    setNumber("");
    setDocumentDate("");
    setDueDate("");
    setAmount("");
    setAccountId("");
    setMemo("");
  }

  function submit() {
    if (!ready) return;
    startTransition(async () => {
      const input = {
        entityId,
        partyId,
        number: number.trim() || undefined,
        documentDate,
        dueDate: dueDate || null,
        amountCents,
        accountId,
        memo: memo.trim() || undefined,
      };
      const result = invoice
        ? await recordOpeningInvoiceAction(input)
        : await recordOpeningBillAction(input);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const party = parties.find((p) => p.id === partyId);
      toast.success(
        invoice
          ? `Recorded ${result.data?.number ?? "the invoice"}, open from ${documentDate}`
          : `Recorded the bill from ${party?.name ?? "the vendor"}, open from ${documentDate}`,
      );
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!booksStartOn}
        title={booksStartOn ? undefined : "Say when the books begin first."}
      >
        <Plus className="mr-2 size-4" />
        {invoice ? "Add an open invoice" : "Add an open bill"}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {invoice ? "An invoice open when the books began" : "A bill open when the books began"}
            </DialogTitle>
            <DialogDescription>
              {invoice
                ? `An invoice you had sent before ${booksStartOn} and had not been paid by then. It becomes a real invoice that ages and can be paid. On ${booksStartOn} it counts as Opening Balance Equity, not this year's sales; when it is paid, the cash basis counts it as income under the account you pick.`
                : `A bill you had received before ${booksStartOn} and had not paid by then. It becomes a real bill that ages and can be paid. On ${booksStartOn} it counts as Opening Balance Equity, not this year's expense; when it is paid, the cash basis counts it under the account you pick.`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="opening-party">{partyWord}</Label>
              <Select value={partyId} onValueChange={setPartyId}>
                <SelectTrigger id="opening-party">
                  <SelectValue placeholder={invoice ? "Pick a customer" : "Pick a vendor"} />
                </SelectTrigger>
                <SelectContent>
                  {parties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {parties.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {invoice
                    ? "No customers yet. Add them on the Customers page first."
                    : "No vendors yet. Add them on the Vendors page first."}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="opening-number">Number</Label>
                <Input
                  id="opening-number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder={invoice ? "As on the invoice, or blank for the next" : "The vendor's invoice number"}
                  maxLength={40}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="opening-amount">Amount still owed</Label>
                <Input
                  id="opening-amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="opening-date">{invoice ? "Issued on" : "Billed on"}</Label>
                <Input
                  id="opening-date"
                  type="date"
                  value={documentDate}
                  max={ceiling}
                  onChange={(e) => setDocumentDate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Before {booksStartOn}.</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="opening-due">Due on (optional)</Label>
                <Input
                  id="opening-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="opening-account">
                {invoice ? "Income account" : "Expense account"}
              </Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="opening-account">
                  <SelectValue placeholder="Pick an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Where the cash basis counts it when the money moves. On the day the books begin it
                is Opening Balance Equity either way.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="opening-memo">Memo (optional)</Label>
              <Input
                id="opening-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={500}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || !ready}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {pending ? "Recording…" : `Record the ${noun}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
