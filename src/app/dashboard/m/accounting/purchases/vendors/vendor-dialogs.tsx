"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
  createVendorAction,
  setVendorActiveAction,
  updateVendorAction,
} from "@/modules/accounting/payables/actions";

const NONE = "__none__";

interface VendorData {
  id: string;
  version: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  defaultExpenseAccountId: string | null;
  paymentTermsId: string | null;
  isActive: boolean;
}

/** A payment term as the dialog offers it; a retired one only while it is this vendor's. */
export interface VendorTermOption {
  id: string;
  name: string;
  isActive: boolean;
}

export function VendorDialogButton({
  accounts,
  terms = [],
  vendor,
}: {
  accounts: Array<{ id: string; label: string }>;
  /** The catalogue's payment terms. Shared with Sales: a term is a term. */
  terms?: VendorTermOption[];
  /** When set, edits this vendor instead of creating. */
  vendor?: VendorData;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(vendor?.name ?? "");
  const [email, setEmail] = useState(vendor?.email ?? "");
  const [phone, setPhone] = useState(vendor?.phone ?? "");
  const [address, setAddress] = useState(vendor?.address ?? "");
  const [defaultAccount, setDefaultAccount] = useState(
    vendor?.defaultExpenseAccountId ?? NONE,
  );
  const [termId, setTermId] = useState(vendor?.paymentTermsId ?? NONE);
  const offeredTerms = terms.filter((t) => t.isActive || t.id === termId);

  function submit() {
    if (!name.trim()) {
      toast.error("A name is required.");
      return;
    }
    startTransition(async () => {
      const patch = {
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        defaultExpenseAccountId: defaultAccount === NONE ? null : defaultAccount,
        paymentTermsId: termId === NONE ? null : termId,
      };
      const result = vendor
        ? await updateVendorAction({
            vendorId: vendor.id,
            expectedVersion: vendor.version,
            patch,
          })
        : await createVendorAction(patch);
      if ("error" in result && result.error) toast.error(result.error);
      else {
        toast.success(vendor ? "Vendor updated." : "Vendor created.");
        setOpen(false);
        router.refresh();
      }
    });
  }

  function toggleActive() {
    if (!vendor) return;
    startTransition(async () => {
      const result = await setVendorActiveAction({
        vendorId: vendor.id,
        expectedVersion: vendor.version,
        isActive: !vendor.isActive,
      });
      if ("error" in result && result.error) toast.error(result.error);
      else {
        toast.success(vendor.isActive ? "Vendor deactivated." : "Vendor reactivated.");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      {vendor ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New vendor
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{vendor ? "Edit vendor" : "New vendor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="v-name">Name</Label>
              <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="v-email">Email</Label>
                <Input id="v-email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-phone">Phone</Label>
                <Input id="v-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="v-address">Address</Label>
              <Input id="v-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Default expense account (optional)</Label>
              <Select value={defaultAccount} onValueChange={setDefaultAccount}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* None means "no terms — the due date is typed": the business
                default is a SALES default, the one new invoices start on, and
                a supplier's terms are theirs rather than ours. */}
            {terms.length > 0 && (
              <div className="space-y-1.5">
                <Label>Payment terms (optional)</Label>
                <Select value={termId} onValueChange={setTermId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {offeredTerms.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.isActive ? t.name : `${t.name} (inactive)`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  A new bill from this vendor gets its due date from these terms.
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            {vendor && (
              <Button variant="ghost" onClick={toggleActive} disabled={pending}>
                {vendor.isActive ? "Deactivate" : "Reactivate"}
              </Button>
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
