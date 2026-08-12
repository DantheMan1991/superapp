"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  createRecurringEntryAction,
  generateRecurringEntriesAction,
  setRecurringEntryActiveAction,
} from "@/modules/accounting/recurring/actions";
import { journalTemplateImbalanceCents } from "@/modules/accounting/recurring/template";
import {
  formatCentsSigned,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface VendorOption {
  id: string;
  name: string;
}

interface JournalRow {
  key: string;
  accountId: string;
  amount: string;
  credit: boolean;
}

const emptyRow = (accountId: string): JournalRow => ({
  key: crypto.randomUUID(),
  accountId,
  amount: "",
  credit: false,
});

export function GenerateRecurringEntriesButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await generateRecurringEntriesAction();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const { created, posted, deferredToDraft, errors } = result.data!;
      if (created === 0 && errors === 0) {
        toast.success("Nothing was due");
      } else {
        toast.success(
          `Created ${created}${posted > 0 ? `, ${posted} posted` : ""}`,
          {
            description:
              [
                deferredToDraft > 0
                  ? `${deferredToDraft} left as drafts — their period is closed`
                  : "",
                errors > 0 ? `${errors} template${errors === 1 ? "" : "s"} failed` : "",
              ]
                .filter(Boolean)
                .join(" · ") || undefined,
          },
        );
      }
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={pending}>
      <Play className="mr-1.5 size-4" />
      {pending ? "Running…" : "Generate now"}
    </Button>
  );
}

export function RecurringEntryToggle({
  id,
  version,
  active,
}: {
  id: string;
  version: number;
  active: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setRecurringEntryActiveAction({
            id,
            expectedVersion: version,
            active: !active,
          });
          if ("error" in result) toast.error(result.error);
          else router.refresh();
        })
      }
    >
      {active ? "Pause" : "Resume"}
    </Button>
  );
}

/**
 * Creating a recurring journal or bill.
 *
 * The journal side shows a running imbalance as you type, because an entry
 * that does not balance is refused at save — and finding that out after
 * filling in six lines, from a red toast, is a worse way to learn it than a
 * number that is visibly not zero.
 */
export function AddRecurringEntryButton({
  accounts,
  vendors,
  today,
}: {
  accounts: AccountOption[];
  vendors: VendorOption[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"journal" | "bill">("journal");
  const [name, setName] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [nextRunDate, setNextRunDate] = useState(today);
  const [autoPost, setAutoPost] = useState(false);
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [dueInDays, setDueInDays] = useState("30");
  const [rows, setRows] = useState<JournalRow[]>([
    emptyRow(accounts[0]?.id ?? ""),
    emptyRow(accounts[0]?.id ?? ""),
  ]);
  const [billDesc, setBillDesc] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billAccountId, setBillAccountId] = useState("");

  const parsedRows = rows.map((r) => {
    const cents = parseMoneyToCents(r.amount);
    return {
      row: r,
      cents: cents === null ? null : r.credit ? -cents : cents,
    };
  });
  const usable = parsedRows.filter((p) => p.cents !== null && p.cents !== 0);
  const imbalance = journalTemplateImbalanceCents(
    usable.map((p) => ({ amountCents: p.cents! })),
  );

  function submit() {
    const day = Number(dayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      toast.error("Day of month must be 1–28");
      return;
    }

    const template =
      kind === "journal"
        ? {
            kind: "journal" as const,
            lines: usable.map((p) => ({
              accountId: p.row.accountId,
              amountCents: p.cents!,
            })),
          }
        : {
            kind: "bill" as const,
            dueInDays: Number(dueInDays) || 0,
            lines: [
              {
                description: billDesc.trim(),
                amountCents: parseMoneyToCents(billAmount) ?? 0,
                accountId: billAccountId || null,
              },
            ],
          };

    startTransition(async () => {
      const result = await createRecurringEntryAction({
        name: name.trim(),
        vendorId: kind === "bill" ? vendorId : null,
        dayOfMonth: day,
        nextRunDate,
        autoPost: kind === "journal" ? autoPost : false,
        template,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(kind === "journal" ? "Recurring journal added" : "Recurring bill added");
      setOpen(false);
      router.refresh();
    });
  }

  const canSubmit =
    name.trim() !== "" &&
    (kind === "journal"
      ? usable.length >= 2 && imbalance === 0
      : vendorId !== "" &&
        billDesc.trim() !== "" &&
        parseMoneyToCents(billAmount) !== null);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> Add recurring
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a recurring entry</DialogTitle>
            <DialogDescription>
              Runs once a month. Catch-up creates one entry per missed month,
              dated to that month rather than to today.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-1">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="rec-kind">Type</Label>
                <Select
                  value={kind}
                  onValueChange={(v) => setKind(v as "journal" | "bill")}
                >
                  <SelectTrigger id="rec-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="journal">Journal entry</SelectItem>
                    <SelectItem value="bill">Bill</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rec-name">Name</Label>
                <Input
                  id="rec-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    kind === "journal" ? "Monthly depreciation" : "Yard rent"
                  }
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="rec-day">Day of month</Label>
                <Input
                  id="rec-day"
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  inputMode="numeric"
                />
                <p className="text-xs text-subtle-foreground">
                  1–28, so every month has one
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-next">First run</Label>
                <Input
                  id="rec-next"
                  type="date"
                  value={nextRunDate}
                  onChange={(e) => setNextRunDate(e.target.value)}
                />
              </div>
              {kind === "bill" && (
                <div className="space-y-1.5">
                  <Label htmlFor="rec-due">Due in days</Label>
                  <Input
                    id="rec-due"
                    value={dueInDays}
                    onChange={(e) => setDueInDays(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
              )}
            </div>

            {kind === "journal" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Lines</Label>
                  <span
                    className={
                      imbalance === 0
                        ? "text-xs text-muted-foreground"
                        : "text-xs font-medium text-warning-foreground"
                    }
                  >
                    {imbalance === 0
                      ? "Balanced"
                      : `Out by ${formatCentsSigned(imbalance)}`}
                  </span>
                </div>
                {rows.map((row, i) => (
                  <div key={row.key} className="flex items-end gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Select
                        value={row.accountId}
                        onValueChange={(v) => {
                          const next = [...rows];
                          next[i] = { ...row, accountId: v };
                          setRows(next);
                        }}
                      >
                        <SelectTrigger aria-label={`Account for line ${i + 1}`}>
                          <SelectValue placeholder="Account" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.code} · {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      className="w-28"
                      value={row.amount}
                      onChange={(e) => {
                        const next = [...rows];
                        next[i] = { ...row, amount: e.target.value };
                        setRows(next);
                      }}
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label={`Amount for line ${i + 1}`}
                    />
                    <Button
                      type="button"
                      variant={row.credit ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        const next = [...rows];
                        next[i] = { ...row, credit: !row.credit };
                        setRows(next);
                      }}
                    >
                      {row.credit ? "Credit" : "Debit"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={rows.length <= 2}
                      onClick={() => setRows(rows.filter((_, j) => j !== i))}
                      aria-label={`Remove line ${i + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRows([...rows, emptyRow(accounts[0]?.id ?? "")])
                  }
                >
                  <Plus className="mr-1.5 size-4" /> Add line
                </Button>

                <div className="flex items-start justify-between gap-4 border-t border-divider pt-3">
                  <div className="space-y-1">
                    <Label htmlFor="rec-autopost" className="text-sm">
                      Post automatically
                    </Label>
                    <p className="max-w-prose text-xs text-muted-foreground">
                      Off by default. When on, each month posts straight to the
                      ledger — except a month whose period is already closed,
                      which is left as a draft.
                    </p>
                  </div>
                  <Switch
                    id="rec-autopost"
                    checked={autoPost}
                    onCheckedChange={setAutoPost}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rec-vendor">Supplier</Label>
                  <Select value={vendorId} onValueChange={setVendorId}>
                    <SelectTrigger id="rec-vendor">
                      <SelectValue placeholder="Pick a supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="rec-desc">Description</Label>
                    <Input
                      id="rec-desc"
                      value={billDesc}
                      onChange={(e) => setBillDesc(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rec-amount">Amount</Label>
                    <Input
                      id="rec-amount"
                      value={billAmount}
                      onChange={(e) => setBillAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rec-bill-account">Category (optional)</Label>
                  <Select value={billAccountId} onValueChange={setBillAccountId}>
                    <SelectTrigger id="rec-bill-account">
                      <SelectValue placeholder="Leave uncoded — AI can code it later" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Bills are always created as drafts — approving one is what
                  posts it.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={submit} disabled={pending || !canSubmit}>
              {pending ? "Adding…" : "Add recurring"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
