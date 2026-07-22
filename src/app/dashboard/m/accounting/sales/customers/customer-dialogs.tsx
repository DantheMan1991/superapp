"use client";

import { useState, useTransition } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  createCustomerAction,
  setCustomerActiveAction,
  updateCustomerAction,
} from "@/modules/accounting/invoicing/actions";

interface CustomerForm {
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

const EMPTY: CustomerForm = { name: "", email: "", phone: "", address: "", notes: "" };

function CustomerFields({
  form,
  setForm,
}: {
  form: CustomerForm;
  setForm: (f: CustomerForm) => void;
}) {
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

export function AddCustomerButton() {
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
          <CustomerFields form={form} setForm={setForm} />
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
}: {
  customer: CustomerForm & { id: string; version: number; isActive: boolean };
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
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit</DropdownMenuItem>
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
          <CustomerFields form={form} setForm={setForm} />
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
