"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Plus } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createCustomerAction,
  setCustomerActiveAction,
  setCustomerRemindersMutedAction,
  updateCustomerAction,
} from "@/modules/accounting/invoicing/actions";

/** A payment term as the dialog offers it. Inactive ones are offered only when they are the customer's current one. */
export interface TermOption {
  id: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
}

interface CustomerForm {
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  /** "" means the business default — `customers.payment_terms_id` null. */
  paymentTermsId: string;
}

const EMPTY: CustomerForm = {
  name: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
  paymentTermsId: "",
};

/** Radix Select cannot carry an empty string as a value, so the default is a sentinel. */
const DEFAULT_TERMS = "__default__";

function CustomerFields({
  form,
  setForm,
  terms,
}: {
  form: CustomerForm;
  setForm: (f: CustomerForm) => void;
  terms: TermOption[];
}) {
  const defaultName = terms.find((t) => t.isDefault)?.name;
  // Active terms, plus the customer's current one even if it was retired —
  // the dialog must show what is set, not silently move them to the default.
  const offered = terms.filter((t) => t.isActive || t.id === form.paymentTermsId);
  return (
    <div className="grid gap-3 py-1">
      <div className="space-y-1.5">
        <Label htmlFor="cust-name">Name</Label>
        <Input
          id="cust-name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cust-email">Email</Label>
          <Input
            id="cust-email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cust-phone">Phone</Label>
          <Input
            id="cust-phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cust-address">Address</Label>
        <Textarea
          id="cust-address"
          rows={2}
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
      </div>
      {/* Shown once the catalogue has terms, like the invoice form's own
          Terms box. Null on the customer means "whatever the default is", so
          changing the default later moves everyone who never had a special
          arrangement — which is what editing the default should do. */}
      {terms.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="cust-terms">Payment terms</Label>
          <Select
            value={form.paymentTermsId || DEFAULT_TERMS}
            onValueChange={(v) =>
              setForm({ ...form, paymentTermsId: v === DEFAULT_TERMS ? "" : v })
            }
          >
            <SelectTrigger id="cust-terms">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_TERMS}>
                {defaultName ? `Business default (${defaultName})` : "Business default"}
              </SelectItem>
              {offered.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.isActive ? t.name : `${t.name} (inactive)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            A new invoice for this customer starts on these terms.
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="cust-notes">Notes</Label>
        <Textarea
          id="cust-notes"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>
    </div>
  );
}

export function AddCustomerButton({ terms = [] }: { terms?: TermOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<CustomerForm>(EMPTY);

  function submit() {
    startTransition(async () => {
      const result = await createCustomerAction({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        notes: form.notes.trim() || undefined,
        paymentTermsId: form.paymentTermsId || null,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Customer added");
        setOpen(false);
        setForm(EMPTY);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> Add customer
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add customer</DialogTitle>
            <DialogDescription>Someone {`you'll`} invoice.</DialogDescription>
          </DialogHeader>
          <CustomerFields form={form} setForm={setForm} terms={terms} />
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !form.name.trim()}>
              {pending ? "Adding…" : "Add customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CustomerRowActions({
  customer,
  terms = [],
}: {
  customer: Omit<CustomerForm, "paymentTermsId"> & {
    id: string;
    version: number;
    isActive: boolean;
    remindersMuted: boolean;
    paymentTermsId: string | null;
  };
  terms?: TermOption[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<CustomerForm>({
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    notes: customer.notes,
    paymentTermsId: customer.paymentTermsId ?? "",
  });

  function saveEdit() {
    startTransition(async () => {
      const result = await updateCustomerAction({
        customerId: customer.id,
        expectedVersion: customer.version,
        patch: {
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          notes: form.notes.trim(),
          paymentTermsId: form.paymentTermsId || null,
        },
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Customer updated");
        setEditOpen(false);
        router.refresh();
      }
    });
  }

  function toggleActive() {
    startTransition(async () => {
      const result = await setCustomerActiveAction({
        customerId: customer.id,
        expectedVersion: customer.version,
        active: !customer.isActive,
      });
      if ("error" in result) toast.error(result.error);
      else router.refresh();
    });
  }

  /** Standing: covers invoices this customer does not have yet. */
  function toggleRemindersMuted() {
    startTransition(async () => {
      const result = await setCustomerRemindersMutedAction({
        customerId: customer.id,
        expectedVersion: customer.version,
        muted: !customer.remindersMuted,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(
          customer.remindersMuted
            ? "Reminders resumed for this customer"
            : "This customer will not be chased automatically",
        );
        router.refresh();
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Customer actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/dashboard/m/accounting/sales/customers/${customer.id}/statement`}>
              Statement
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit</DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleRemindersMuted} disabled={pending}>
            {customer.remindersMuted ? "Resume reminders" : "Never send reminders"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleActive} disabled={pending}>
            {customer.isActive ? "Deactivate" : "Reactivate"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit customer</DialogTitle>
          </DialogHeader>
          <CustomerFields form={form} setForm={setForm} terms={terms} />
          <DialogFooter>
            <Button onClick={saveEdit} disabled={pending || !form.name.trim()}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
