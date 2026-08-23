"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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
  createPaymentMethodAction,
  createPaymentTermAction,
  createProductAction,
  createSalesTaxRateAction,
  restoreCatalogueDefaultsAction,
  setDefaultPaymentTermAction,
  setDefaultSalesTaxRateAction,
  setPaymentMethodActiveAction,
  setPaymentTermActiveAction,
  setProductActiveAction,
  setSalesTaxRateActiveAction,
  updateSalesTaxRateAction,
} from "@/modules/accounting/invoicing/catalogue-actions";
import { parseMoneyToCents } from "@/modules/accounting/lib/money";
import { MAX_DUE_IN_DAYS } from "@/modules/accounting/invoicing/terms";
import { parseRatePercentToPpm, formatRatePpm } from "@/modules/accounting/invoicing/tax";

/**
 * Editing the four reference lists.
 *
 * Deactivate rather than delete throughout, and the reason is on the page: a
 * saved item, a term or a rate may be named on records that already exist, and
 * removing the row would rewrite what those records meant.
 */

/**
 * The way out of an empty terms or methods list.
 *
 * These lists arrive with the chart of accounts, so an empty one means the
 * tenant predates them rather than that somebody cleared it out — you cannot
 * delete a term or a method, only deactivate it. One button beats typing
 * "Net 30, Net 15, Due on receipt, Net 60" from memory.
 */
export function RestoreDefaultsButton({ what }: { what: "terms" | "methods" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await restoreCatalogueDefaultsAction();
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          const { termsCreated, methodsCreated } = result.data!;
          const n = what === "terms" ? termsCreated : methodsCreated;
          toast.success(
            n > 0
              ? `Added ${n} standard ${what === "terms" ? "term" : "method"}${n === 1 ? "" : "s"}`
              : "Nothing to add — you already have them",
          );
          router.refresh();
        })
      }
    >
      {pending ? "Adding…" : "Add the standard set"}
    </Button>
  );
}

/* -- products ------------------------------------------------------------- */

export function AddProductButton({
  incomeAccounts,
}: {
  incomeAccounts: Array<{ id: string; code: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    incomeAccountId: incomeAccounts[0]?.id ?? "",
  });

  function submit() {
    const cents = form.price.trim() === "" ? 0 : parseMoneyToCents(form.price);
    if (cents === null) {
      toast.error("That price isn't a money amount");
      return;
    }
    startTransition(async () => {
      const result = await createProductAction({
        name: form.name.trim(),
        description: form.description.trim(),
        unitPriceCents: cents,
        incomeAccountId: form.incomeAccountId || null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved item added");
      setOpen(false);
      setForm({
        name: "",
        description: "",
        price: "",
        incomeAccountId: incomeAccounts[0]?.id ?? "",
      });
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> Add item
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a saved item</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="prod-name">Name</Label>
              <Input
                id="prod-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prod-desc">Description on the invoice</Label>
              <Input
                id="prod-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Defaults to the name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="prod-price">Default price</Label>
                <Input
                  id="prod-price"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prod-account">Income account</Label>
                <Select
                  value={form.incomeAccountId}
                  onValueChange={(v) => setForm({ ...form, incomeAccountId: v })}
                >
                  <SelectTrigger id="prod-account">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {incomeAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !form.name.trim()}>
              {pending ? "Adding…" : "Add item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* -- shared row toggle ---------------------------------------------------- */

export function ActiveToggle({
  id,
  version,
  active,
  kind,
}: {
  id: string;
  version: number;
  active: boolean;
  kind: "product" | "term" | "method" | "taxRate";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const args = { id, expectedVersion: version, active: !active };
      const result =
        kind === "product"
          ? await setProductActiveAction(args)
          : kind === "term"
            ? await setPaymentTermActiveAction(args)
            : kind === "taxRate"
              ? await setSalesTaxRateActiveAction(args)
              : await setPaymentMethodActiveAction(args);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggle} disabled={pending}>
      {active ? "Deactivate" : "Reactivate"}
    </Button>
  );
}

export function MakeDefaultButton({ termId }: { termId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setDefaultPaymentTermAction({ termId });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success("Default terms updated");
          router.refresh();
        })
      }
    >
      <Star className="mr-1 size-3.5" /> Make default
    </Button>
  );
}

/* -- terms and methods ---------------------------------------------------- */

export function AddTermButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ name: "", days: "" });

  function submit() {
    const days = Number(form.days);
    if (!Number.isInteger(days) || days < 0 || days > MAX_DUE_IN_DAYS) {
      toast.error(`Days must be a whole number from 0 to ${MAX_DUE_IN_DAYS}`);
      return;
    }
    startTransition(async () => {
      const result = await createPaymentTermAction({
        name: form.name.trim(),
        dueInDays: days,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Term added");
      setOpen(false);
      setForm({ name: "", days: "" });
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> Add term
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a payment term</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="term-name">Name</Label>
              <Input
                id="term-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Net 45"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="term-days">Days until due</Label>
              <Input
                id="term-days"
                value={form.days}
                onChange={(e) => setForm({ ...form, days: e.target.value })}
                inputMode="numeric"
                placeholder="45"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !form.name.trim()}>
              {pending ? "Adding…" : "Add term"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AddMethodButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await createPaymentMethodAction({ name: name.trim() });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Payment method added");
      setOpen(false);
      setName("");
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> Add method
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a payment method</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="method-name">Name</Label>
            <Input
              id="method-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Zelle"
            />
            <p className="text-xs text-muted-foreground">
              Recorded on payments from now on. Existing payments keep whatever
              they were saved with.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !name.trim()}>
              {pending ? "Adding…" : "Add method"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DefaultBadge() {
  return <Badge variant="outline">default</Badge>;
}

/* -- sales tax rates ------------------------------------------------------ */

export function MakeDefaultRateButton({ rateId }: { rateId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setDefaultSalesTaxRateAction({ rateId });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success("Default tax rate updated");
          router.refresh();
        })
      }
    >
      <Star className="mr-1 size-3.5" /> Make default
    </Button>
  );
}

/**
 * Add or edit a rate. One dialog for both, because the fields are identical
 * and the only difference is which action it calls.
 */
export function TaxRateDialogButton({
  rate,
}: {
  /** Absent = adding. Present = editing that rate. */
  rate?: { id: string; name: string; ratePpm: number; version: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: rate?.name ?? "",
    percent: rate ? formatRatePpm(rate.ratePpm) : "",
  });

  function submit() {
    const ppm = parseRatePercentToPpm(form.percent);
    if (ppm === null) {
      toast.error("Enter a percentage from 0 to 100, up to four decimals");
      return;
    }
    startTransition(async () => {
      const payload = { name: form.name.trim(), ratePpm: ppm };
      const result = rate
        ? await updateSalesTaxRateAction({
            rateId: rate.id,
            expectedVersion: rate.version,
            patch: payload,
          })
        : await createSalesTaxRateAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(rate ? "Tax rate updated" : "Tax rate added");
      setOpen(false);
      if (!rate) setForm({ name: "", percent: "" });
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant={rate ? "ghost" : "outline"}
        onClick={() => setOpen(true)}
      >
        {rate ? (
          "Edit"
        ) : (
          <>
            <Plus className="mr-1.5 size-4" /> Add tax rate
          </>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rate ? "Edit tax rate" : "Add a sales tax rate"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="rate-name">Name</Label>
              <Input
                id="rate-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ohio state and county"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-percent">Rate %</Label>
              <Input
                id="rate-percent"
                value={form.percent}
                onChange={(e) => setForm({ ...form, percent: e.target.value })}
                inputMode="decimal"
                placeholder="7.25"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {rate
              ? "Changing the rate applies to invoices written from now on. Invoices already issued keep the rate they charged."
              : "Combine state, county and city into one rate if you remit them together. Up to four decimal places."}
          </p>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !form.name.trim()}>
              {pending ? "Saving…" : rate ? "Save rate" : "Add tax rate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
