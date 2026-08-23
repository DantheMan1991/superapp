"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setTaxRuleAction, clearTaxRuleAction } from "../actions";
import {
  IMPLEMENTED_TIMING_RULES,
  isSubstitutingRule,
  TIMING_RULES,
  TIMING_RULE_LABELS,
  TIMING_RULE_NOTES,
  type TimingRule,
} from "../core/tax-rules";

const NO_ACCOUNT = "__none__";

export interface AccountChoice {
  id: string;
  label: string;
}

/**
 * **RECORD A DECISION SOMEBODY ELSE MADE.**
 * [ADR 0013](../../../../docs/decisions/0013-inventory-tax-treatment.md) §A.2.
 *
 * **THE UNAVAILABLE RULES ARE SHOWN, NOT HIDDEN, and that is deliberate.** This
 * screen exists so an accountant's answer has somewhere to go, and the answer
 * may well be one the reports cannot apply yet. Hiding those would let somebody
 * conclude the software does not do it at all; showing them disabled says the
 * shape of the question and where the software has got to, which is what a
 * person needs to know before they go and ask.
 *
 * The server refuses them too. This is the polite half of a rule that is
 * enforced in `setTaxRule`, never the only half.
 */
export function TaxRuleForm({
  itemKind,
  current,
  accounts,
  today,
  trigger,
}: {
  /** Null records the business-wide default. */
  itemKind: string | null;
  current: {
    timingRule: TimingRule;
    expenseAccountId: string | null;
    decidedBy: string;
    decidedOn: string | null;
    notes: string;
  } | null;
  accounts: AccountChoice[];
  today: string;
  trigger: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rule, setRule] = useState<TimingRule>(
    current?.timingRule ?? "consumed",
  );
  const [account, setAccount] = useState(
    current?.expenseAccountId ?? NO_ACCOUNT,
  );

  const what = itemKind ? `“${itemKind}”` : "everything else";
  /** Every rule but `consumed` moves cost, and `setTaxRule` refuses without one. */
  const needsAccount = isSubstitutingRule(rule);

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await setTaxRuleAction({
        itemKind,
        timingRule: rule,
        expenseAccountId: account === NO_ACCOUNT ? null : account,
        decidedBy: String(formData.get("decidedBy") ?? ""),
        decidedOn: String(formData.get("decidedOn") ?? "") || null,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Recorded.");
      setOpen(false);
      router.refresh();
    });
  }

  function clear() {
    startTransition(async () => {
      const result = await clearTaxRuleAction({ itemKind });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Removed — it falls back to whatever covers it.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>When is {what} deducted?</DialogTitle>
            <DialogDescription>
              This is where an accountant&apos;s answer goes. It is a record of
              what somebody qualified decided, not a preference — so it asks who
              and when.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="rule">The cost lands</Label>
              <Select
                value={rule}
                onValueChange={(v) => setRule(v as TimingRule)}
              >
                <SelectTrigger id="rule">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMING_RULES.map((r) => {
                    const available = (
                      IMPLEMENTED_TIMING_RULES as readonly string[]
                    ).includes(r);
                    return (
                      <SelectItem key={r} value={r} disabled={!available}>
                        {TIMING_RULE_LABELS[r]}
                        {!available && " — not built yet"}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {TIMING_RULE_NOTES[rule]}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="account">Which expense account</Label>
              <Select value={account} onValueChange={setAccount}>
                <SelectTrigger id="account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACCOUNT}>Not decided</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* "All of it to cost of goods sold" balances and is no use at
                  return time, where feed, seed and veterinary supplies are
                  separate lines. ADR 0013 A.5.

                  **THE HINT FOLLOWS THE RULE, and it did not until somebody
                  picked "paid" and read it.** It said the account could stay
                  undecided, which is true under "when it is used" and wrong
                  under every other rule — where the server refuses to save at
                  all. A field that tells you it is optional and then refuses is
                  worse than one that never explained itself. */}
              <p className="text-xs text-muted-foreground">
                {needsAccount
                  ? "Required for this rule. The cost has to land somewhere you chose — feed, seed and veterinary supplies are separate lines at return time, so “all of it to cost of goods” is no use."
                  : "Only used by a rule that moves cost off the balance sheet. Under “when it is used” nothing substitutes, so this can stay undecided."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="decidedBy">Who decided</Label>
                <Input
                  id="decidedBy"
                  name="decidedBy"
                  maxLength={200}
                  defaultValue={current?.decidedBy ?? ""}
                  placeholder="Their name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="decidedOn">When</Label>
                <Input
                  id="decidedOn"
                  name="decidedOn"
                  type="date"
                  max={today}
                  defaultValue={current?.decidedOn ?? ""}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tax-notes">Notes</Label>
              <Textarea
                id="tax-notes"
                name="notes"
                rows={2}
                defaultValue={current?.notes ?? ""}
                placeholder="Anything they said that the columns do not carry"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {/* Removing is not the same as setting it back to "when it is
                used": one means nobody has decided, the other means somebody
                did. The list shows which, so they must stay tellable apart. */}
            {current ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={clear}
              >
                Remove
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Recording…" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
