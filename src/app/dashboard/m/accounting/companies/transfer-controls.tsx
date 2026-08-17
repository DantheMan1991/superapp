"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recordIntercompanyTransferAction } from "@/modules/accounting/intercompany-actions";
import { parseMoneyToCents } from "@/modules/accounting/lib/money";

export interface TransferRegister {
  ledgerAccountId: string;
  name: string;
  entityId: string;
  entityName: string;
}

export interface TransferAccount {
  id: string;
  code: string;
  name: string;
}

/**
 * Moving money between two companies of one client (ADR 0010 slice 2).
 *
 * IT ASKS FOR THE ACCOUNT, NOT THE PAYING COMPANY. The account's owner IS the
 * payer, so asking both invites an answer where the two disagree — and the
 * posting engine would refuse that anyway. One question, no way to get it
 * wrong.
 *
 * "WHAT THEY GOT" IS REQUIRED, and the first cut of this dialog had it wrong.
 * It offered "it did not reach their account", which produced a receiving entry
 * of one affiliate line — an entry that cannot balance and cannot post, and the
 * server said so in terms about journal lines rather than about companies.
 * Found by driving it on the live tenant.
 *
 * There is no accounting for nothing: if a company is better off by an amount,
 * its books have to say what it got. Its own register when cash arrived, or the
 * expense or asset the payer bought on its behalf.
 */
export function TransferButton({
  registers,
  companies,
  accounts,
  today,
}: {
  registers: TransferRegister[];
  companies: Array<{ id: string; name: string }>;
  /**
   * Everything the receiving side may have got that is NOT a register —
   * expenses, assets, payables. Registers of other companies are excluded
   * upstream, because money cannot land in a third company's account.
   */
  accounts: TransferAccount[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [fromAccountId, setFromAccountId] = useState("");
  const [toEntityId, setToEntityId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState("");

  const payer = registers.find((r) => r.ledgerAccountId === fromAccountId);
  // Only the RECEIVING company's own accounts, because money cannot land in a
  // third company's register — that would be a second transfer.
  const receiving = registers.filter((r) => r.entityId === toEntityId);

  function submit() {
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0) {
      toast.error("Enter an amount above zero.");
      return;
    }
    startTransition(async () => {
      const result = await recordIntercompanyTransferAction({
        fromAccountId,
        toEntityId,
        amountCents: cents,
        entryDate: date,
        memo: memo.trim() || undefined,
        toAccountId,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Transfer recorded in both companies");
      setOpen(false);
      setFromAccountId("");
      setToEntityId("");
      setToAccountId("");
      setAmount("");
      setMemo("");
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ArrowLeftRight className="h-4 w-4" />
        Move money
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move money between companies</DialogTitle>
            <DialogDescription>
              Recorded on both sides at once: the paying company is owed the
              amount, and the other owes it, until it is settled.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Paid from</Label>
              <Select
                value={fromAccountId || undefined}
                onValueChange={setFromAccountId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Which account did the money leave?" />
                </SelectTrigger>
                <SelectContent>
                  {registers.map((r) => (
                    <SelectItem key={r.ledgerAccountId} value={r.ledgerAccountId}>
                      {r.entityName} · {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>To company</Label>
              <Select
                value={toEntityId || undefined}
                onValueChange={(v) => {
                  setToEntityId(v);
                  setToAccountId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Which company benefited?" />
                </SelectTrigger>
                <SelectContent>
                  {companies
                    // Never the payer's own company: that is not a transfer,
                    // and the engine refuses it.
                    .filter((c) => c.id !== payer?.entityId)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {toEntityId && (
              <div className="space-y-1.5">
                <Label>What did they get?</Label>
                <Select
                  value={toAccountId || undefined}
                  onValueChange={setToAccountId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Cash into an account, or what it paid for" />
                  </SelectTrigger>
                  <SelectContent>
                    {receiving.map((r) => (
                      <SelectItem key={r.ledgerAccountId} value={r.ledgerAccountId}>
                        {r.name} (cash in)
                      </SelectItem>
                    ))}
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Their own account if the cash reached them, otherwise whatever
                  it paid for on their behalf.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ic-amount">Amount</Label>
                <Input
                  id="ic-amount"
                  inputMode="decimal"
                  value={amount}
                  placeholder="0.00"
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ic-date">Date</Label>
                <Input
                  id="ic-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ic-memo">Memo</Label>
              <Input
                id="ic-memo"
                value={memo}
                placeholder="What was it for?"
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                pending || !fromAccountId || !toEntityId || !toAccountId || !amount
              }
              onClick={submit}
            >
              {pending ? "Recording…" : "Record transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
