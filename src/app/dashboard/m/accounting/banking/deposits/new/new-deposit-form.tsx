"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Panel } from "@/components/app/panel";
import { recordDepositAction } from "@/modules/accounting/banking/deposit-actions";
import { formatCents } from "@/modules/accounting/lib/money";

export interface DepositablePayment {
  id: string;
  paymentDate: string;
  amountCents: number;
  method: string;
  memo: string;
  invoiceNumber: string;
  customerName: string;
}

/**
 * The deposit slip.
 *
 * EVERY PAYMENT STARTS TICKED. The common Friday is "everything in the drawer
 * goes to the bank", and a form that starts empty makes the common case the
 * one with the most taps. Unticking is for the cheque that is still in the
 * truck. The total under the list follows the ticks, so what will post is
 * never a surprise.
 *
 * One markup for the phone and the desk: each payment is a row of checkbox,
 * words and amount, which is a shape that needs no table.
 */
export function NewDepositForm({
  registers,
  payments,
  today,
}: {
  registers: Array<{ id: string; name: string }>;
  payments: DepositablePayment[];
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [bankAccountId, setBankAccountId] = useState(registers[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(payments.map((p) => p.id)),
  );

  const all = picked.size === payments.length;
  const total = payments
    .filter((p) => picked.has(p.id))
    .reduce((s, p) => s + p.amountCents, 0);
  const registerName = registers.find((r) => r.id === bankAccountId)?.name ?? "";

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function submit() {
    startTransition(async () => {
      const result = await recordDepositAction({
        bankAccountId,
        depositDate: date,
        memo: memo.trim() || undefined,
        paymentIds: [...picked],
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Deposited ${formatCents(result.data!.totalCents)} into ${registerName} — match the bank's line when it arrives`,
      );
      router.push(`/dashboard/m/accounting/banking/deposits/${result.data!.depositId}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="deposit-account">Deposit to</Label>
          <Select value={bankAccountId} onValueChange={setBankAccountId}>
            <SelectTrigger id="deposit-account" className="w-full">
              <SelectValue placeholder="Pick an account" />
            </SelectTrigger>
            <SelectContent>
              {registers.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deposit-date">Date</Label>
          <Input
            id="deposit-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deposit-memo">Memo (optional)</Label>
          <Input
            id="deposit-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={
              payments.length === 1
                ? `Deposit — ${payments[0].customerName}`
                : `Deposit — ${payments.length} payments`
            }
            maxLength={500}
          />
        </div>
      </div>

      <Panel>
        <div className="flex items-center gap-3 border-b border-divider px-4 py-2.5 text-sm">
          <Checkbox
            id="deposit-all"
            checked={all}
            onCheckedChange={(v) =>
              setPicked(v === true ? new Set(payments.map((p) => p.id)) : new Set())
            }
            aria-label="Select every payment"
          />
          <Label htmlFor="deposit-all" className="font-medium">
            {picked.size === payments.length
              ? `All ${payments.length === 1 ? "1 payment" : `${payments.length} payments`}`
              : `${picked.size} of ${payments.length} payments`}
          </Label>
        </div>
        <ul className="divide-y divide-divider">
          {payments.map((p) => {
            const on = picked.has(p.id);
            return (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <Checkbox
                  id={`pay-${p.id}`}
                  checked={on}
                  onCheckedChange={(v) => toggle(p.id, v === true)}
                  aria-label={`${p.customerName} ${p.invoiceNumber}`}
                />
                <label htmlFor={`pay-${p.id}`} className="min-w-0 flex-1 cursor-pointer">
                  <p className="truncate text-sm font-medium">
                    {p.customerName}{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.invoiceNumber}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{p.paymentDate}</span> ·{" "}
                    {p.method.replaceAll("_", " ")}
                    {p.memo ? ` · ${p.memo}` : ""}
                  </p>
                </label>
                <span
                  className={
                    on
                      ? "font-mono text-sm tabular-nums"
                      : "font-mono text-sm tabular-nums text-subtle-foreground line-through"
                  }
                >
                  {formatCents(p.amountCents)}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Depositing{" "}
          <span className="font-mono font-medium text-foreground tabular-nums">
            {formatCents(total)}
          </span>
          {registerName ? ` into ${registerName}` : ""}. One entry posts, and the
          bank&apos;s line for it matches that entry.
        </p>
        <Button
          onClick={submit}
          disabled={pending || picked.size === 0 || !bankAccountId || !date}
        >
          {pending ? "Recording…" : "Record deposit"}
        </Button>
      </div>
    </div>
  );
}
