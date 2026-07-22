"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Plus, Trash2 } from "lucide-react";
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
  createRecurringInvoiceAction,
  generateRecurringInvoicesAction,
  setRecurringActiveAction,
} from "@/modules/accounting/invoicing/actions";
import { parseMoneyToCents } from "@/modules/accounting/lib/money";

export function GenerateNowButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await generateRecurringInvoicesAction();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const { created, errors } = result.data!;
      toast.success(
        `Created ${created} draft${created === 1 ? "" : "s"}` +
          (errors.length > 0
            ? ` · ${errors.length} template${errors.length === 1 ? "" : "s"} skipped`
            : ""),
      );
      router.refresh();
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={run} disabled={pending}>
      <Play className="mr-1.5 size-3.5" />
      {pending ? "Generating…" : "Generate now"}
    </Button>
  );
}

interface TemplateLineRow {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  incomeAccountId: string;
}

export function AddRecurringButton({
  customers,
  incomeAccounts,
}: {
  customers: Array<{ id: string; name: string }>;
  incomeAccounts: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const defaultAccount = incomeAccounts[0]?.id ?? "";
  const [form, setForm] = useState({
    customerId: "",
    name: "",
    dayOfMonth: "1",
    nextRunDate: "",
    dueInDays: "15",
  });
  const [lines, setLines] = useState<TemplateLineRow[]>([
    {
      key: crypto.randomUUID(),
      description: "",
      quantity: "1",
      unitPrice: "",
      incomeAccountId: defaultAccount,
    },
  ]);

  function setLine(key: string, patch: Partial<TemplateLineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function submit() {
    const templateLines: Array<{
      description: string;
      quantity: string;
      unitPriceCents: number;
      incomeAccountId: string;
    }> = [];
    for (const l of lines) {
      const price = parseMoneyToCents(l.unitPrice);
      if (price === null || !l.incomeAccountId) {
        toast.error("Every line needs a price and an income account");
        return;
      }
      templateLines.push({
        description: l.description.trim(),
        quantity: l.quantity,
        unitPriceCents: price,
        incomeAccountId: l.incomeAccountId,
      });
    }
    startTransition(async () => {
      const result = await createRecurringInvoiceAction({
        customerId: form.customerId,
        name: form.name.trim(),
        dayOfMonth: Number(form.dayOfMonth),
        nextRunDate: form.nextRunDate,
        template: {
          lines: templateLines,
          dueInDays: Number(form.dueInDays),
        },
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Recurring template created");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> New template
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New recurring template</DialogTitle>
            <DialogDescription>
              Generates a draft invoice each month for review — nothing posts
              automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rec-name">Template name</Label>
                <Input
                  id="rec-name"
                  placeholder="Rent — 123 Maple St"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select
                  value={form.customerId || undefined}
                  onValueChange={(v) => setForm({ ...form, customerId: v })}
                >
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
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rec-day">Day of month (1–28)</Label>
                <Input
                  id="rec-day"
                  type="number"
                  min={1}
                  max={28}
                  value={form.dayOfMonth}
                  onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-next">First run date</Label>
                <Input
                  id="rec-next"
                  type="date"
                  value={form.nextRunDate}
                  onChange={(e) => setForm({ ...form, nextRunDate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-due">Due in (days)</Label>
                <Input
                  id="rec-due"
                  type="number"
                  min={0}
                  max={365}
                  value={form.dueInDays}
                  onChange={(e) => setForm({ ...form, dueInDays: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Lines</Label>
              {lines.map((l) => (
                <div
                  key={l.key}
                  className="grid grid-cols-[1fr_80px_110px_1fr_32px] items-center gap-2"
                >
                  <Input
                    className="h-9"
                    placeholder="Description"
                    value={l.description}
                    onChange={(e) => setLine(l.key, { description: e.target.value })}
                  />
                  <Input
                    inputMode="decimal"
                    className="h-9 text-right font-mono"
                    value={l.quantity}
                    onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                  />
                  <Input
                    inputMode="decimal"
                    className="h-9 text-right font-mono"
                    placeholder="0.00"
                    value={l.unitPrice}
                    onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
                  />
                  <Select
                    value={l.incomeAccountId || undefined}
                    onValueChange={(v) => setLine(l.key, { incomeAccountId: v })}
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    disabled={lines.length <= 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
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
                  setLines((ls) => [
                    ...ls,
                    {
                      key: crypto.randomUUID(),
                      description: "",
                      quantity: "1",
                      unitPrice: "",
                      incomeAccountId: defaultAccount,
                    },
                  ])
                }
              >
                <Plus className="mr-1.5 size-4" /> Add line
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={submit}
              disabled={
                pending || !form.customerId || !form.name.trim() || !form.nextRunDate
              }
            >
              {pending ? "Creating…" : "Create template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RecurringRowActions({
  template,
}: {
  template: { id: string; version: number; isActive: boolean };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await setRecurringActiveAction({
        recurringInvoiceId: template.id,
        expectedVersion: template.version,
        active: !template.isActive,
      });
      if ("error" in result) toast.error(result.error);
      else router.refresh();
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={toggle} disabled={pending}>
      {template.isActive ? "Pause" : "Resume"}
    </Button>
  );
}
