"use client";

import { useState, useTransition } from "react";
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
  DialogTrigger,
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
import {
  createCoaAccount,
  setCoaAccountActive,
  updateCoaAccount,
} from "@/modules/accounting/actions";

export interface SlimAccount {
  id: string;
  code: string;
  name: string;
  accountType: "asset" | "liability" | "equity" | "income" | "expense";
  subtype: string;
  parentId: string | null;
  description: string;
  isActive: boolean;
  isSystem: boolean;
  version: number;
}

const TYPES: Array<{ value: SlimAccount["accountType"]; label: string }> = [
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "equity", label: "Equity" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
];

const NONE = "__none__";

interface FormState {
  code: string;
  name: string;
  accountType: SlimAccount["accountType"];
  parentId: string;
  description: string;
}

function AccountFields({
  form,
  setForm,
  accounts,
  typeLocked,
  excludeId,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  accounts: SlimAccount[];
  typeLocked?: boolean;
  excludeId?: string;
}) {
  const parentOptions = accounts.filter(
    (a) =>
      a.accountType === form.accountType &&
      a.isActive &&
      a.id !== excludeId &&
      // Only depth-1/2 accounts can take children (max 3 levels).
      (a.parentId === null ||
        accounts.find((p) => p.id === a.parentId)?.parentId == null),
  );
  return (
    <div className="grid gap-4 py-2">
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="acct-code">Code</Label>
          <Input
            id="acct-code"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="6800"
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="acct-name">Name</Label>
          <Input
            id="acct-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Equipment Rental"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select
            value={form.accountType}
            onValueChange={(v) =>
              setForm({
                ...form,
                accountType: v as SlimAccount["accountType"],
                parentId: NONE,
              })
            }
            disabled={typeLocked}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Parent account</Label>
          <Select
            value={form.parentId}
            onValueChange={(v) => setForm({ ...form, parentId: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None (top level)</SelectItem>
              {parentOptions.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="acct-desc">Description (optional)</Label>
        <Input
          id="acct-desc"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>
    </div>
  );
}

export function AddAccountButton({ accounts }: { accounts: SlimAccount[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>({
    code: "",
    name: "",
    accountType: "expense",
    parentId: NONE,
    description: "",
  });

  function submit() {
    startTransition(async () => {
      const result = await createCoaAccount({
        code: form.code.trim(),
        name: form.name.trim(),
        accountType: form.accountType,
        parentId: form.parentId === NONE ? null : form.parentId,
        description: form.description.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Account added");
        setOpen(false);
        setForm({ code: "", name: "", accountType: "expense", parentId: NONE, description: "" });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 size-4" /> Add account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>
            A new category in the chart of accounts.
          </DialogDescription>
        </DialogHeader>
        <AccountFields form={form} setForm={setForm} accounts={accounts} />
        <DialogFooter>
          <Button
            onClick={submit}
            disabled={pending || !form.code.trim() || !form.name.trim()}
          >
            {pending ? "Adding…" : "Add account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AccountRowActions({
  account,
  accounts,
}: {
  account: SlimAccount;
  accounts: SlimAccount[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>({
    code: account.code,
    name: account.name,
    accountType: account.accountType,
    parentId: account.parentId ?? NONE,
    description: account.description,
  });

  function saveEdit() {
    startTransition(async () => {
      const result = await updateCoaAccount({
        accountId: account.id,
        expectedVersion: account.version,
        patch: {
          ...(account.isSystem ? {} : { code: form.code.trim() }),
          name: form.name.trim(),
          ...(account.isSystem
            ? {}
            : { parentId: form.parentId === NONE ? null : form.parentId }),
          description: form.description.trim(),
        },
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Account updated");
        setEditOpen(false);
      }
    });
  }

  function toggleActive() {
    startTransition(async () => {
      const result = await setCoaAccountActive({
        accountId: account.id,
        expectedVersion: account.version,
        active: !account.isActive,
      });
      if ("error" in result) toast.error(result.error);
      else toast.success(account.isActive ? "Account deactivated" : "Account reactivated");
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7">
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Account actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit</DropdownMenuItem>
          {!account.isSystem && (
            <DropdownMenuItem onSelect={toggleActive} disabled={pending}>
              {account.isActive ? "Deactivate" : "Reactivate"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit account</DialogTitle>
            <DialogDescription>
              {account.isSystem
                ? "System account — the code, type, and position are fixed."
                : "Changes apply everywhere this account is used."}
            </DialogDescription>
          </DialogHeader>
          <AccountFields
            form={form}
            setForm={setForm}
            accounts={accounts}
            typeLocked
            excludeId={account.id}
          />
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
