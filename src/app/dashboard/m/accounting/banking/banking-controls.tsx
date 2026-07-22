"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import { Landmark, Plus, RefreshCw, Unplug, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  createBankAccountAction,
  createPlaidLinkTokenAction,
  disconnectPlaidItemAction,
  exchangePlaidPublicTokenAction,
  linkPlaidAccountsAction,
  quickAddTransactionAction,
  syncPlaidItemAction,
} from "@/modules/accounting/banking/actions";
import { parseMoneyToCents } from "@/modules/accounting/lib/money";

interface BankAccountOption {
  id: string;
  name: string;
  kind: string;
}

interface CategoryOption {
  id: string;
  code: string;
  name: string;
  accountType: string;
}

// ------------------------------------------------------------- Plaid link

interface DiscoveredAccount {
  plaidAccountId: string;
  name: string;
  mask: string;
  kind: "checking" | "savings" | "credit_card";
}

function PlaidLauncher({
  linkToken,
  onDone,
}: {
  linkToken: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [discovered, setDiscovered] = useState<{
    plaidItemId: string;
    institutionName: string;
    accounts: DiscoveredAccount[];
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken, metadata) => {
      const institutionName = metadata.institution?.name ?? "Bank";
      startTransition(async () => {
        const result = await exchangePlaidPublicTokenAction({
          publicToken,
          institutionName,
        });
        if ("error" in result) {
          toast.error(result.error);
          onDone();
          return;
        }
        setDiscovered({ ...result.data!, institutionName });
        setSelected(new Set(result.data!.accounts.map((a) => a.plaidAccountId)));
      });
    },
    onExit: () => onDone(),
  });

  // Launch Plaid Link exactly once, as soon as it's ready.
  const launched = useRef(false);
  useEffect(() => {
    if (ready && !launched.current) {
      launched.current = true;
      open();
    }
  }, [ready, open]);

  function confirmLink() {
    if (!discovered) return;
    const selections = discovered.accounts
      .filter((a) => selected.has(a.plaidAccountId))
      .map((a) => ({
        plaidAccountId: a.plaidAccountId,
        name: a.name,
        mask: a.mask,
        kind: a.kind,
        existingBankAccountId: null,
      }));
    if (selections.length === 0) {
      onDone();
      return;
    }
    startTransition(async () => {
      const result = await linkPlaidAccountsAction({
        plaidItemId: discovered.plaidItemId,
        institutionName: discovered.institutionName,
        selections,
      });
      if ("error" in result) toast.error(result.error);
      else toast.success(`Linked ${result.data!.linked} account${result.data!.linked === 1 ? "" : "s"}`);
      onDone();
      router.refresh();
    });
  }

  return (
    <Dialog open={discovered !== null} onOpenChange={(o) => !o && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link accounts from {discovered?.institutionName}</DialogTitle>
          <DialogDescription>
            Each linked account becomes a register with its own ledger account.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 py-1">
          {discovered?.accounts.map((a) => (
            <li key={a.plaidAccountId} className="flex items-center gap-3">
              <input
                type="checkbox"
                className="size-4"
                checked={selected.has(a.plaidAccountId)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(a.plaidAccountId);
                  else next.delete(a.plaidAccountId);
                  setSelected(next);
                }}
              />
              <span className="flex-1 text-sm">
                {a.name}
                {a.mask && (
                  <span className="text-muted-foreground"> ···· {a.mask}</span>
                )}
              </span>
              <Badge variant="secondary">{a.kind.replaceAll("_", " ")}</Badge>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={confirmLink} disabled={pending || selected.size === 0}>
            {pending ? "Linking…" : `Link ${selected.size} account${selected.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------- header buttons

export function BankingHeaderButtons({
  plaidReady,
  bankAccounts,
  categories,
}: {
  plaidReady: boolean;
  bankAccounts: BankAccountOption[];
  categories: CategoryOption[];
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function connect() {
    startTransition(async () => {
      const result = await createPlaidLinkTokenAction();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setLinkToken(result.data!.linkToken);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {plaidReady && (
        <Button size="sm" onClick={connect} disabled={pending || linkToken !== null}>
          <Zap className="mr-1.5 size-4" />
          {pending ? "Preparing…" : "Connect a bank"}
        </Button>
      )}
      <CreateBankAccountButton />
      {bankAccounts.length > 0 && (
        <QuickAddButton bankAccounts={bankAccounts} categories={categories} />
      )}
      {linkToken && (
        <PlaidLauncher linkToken={linkToken} onDone={() => setLinkToken(null)} />
      )}
    </div>
  );
}

// -------------------------------------------------- create bank account

function CreateBankAccountButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: "",
    kind: "checking" as "checking" | "savings" | "credit_card",
    institution: "",
    last4: "",
    openingBalance: "",
    openingDate: "",
  });

  function submit() {
    const cents =
      form.openingBalance.trim() === ""
        ? null
        : parseMoneyToCents(form.openingBalance);
    if (form.openingBalance.trim() !== "" && cents === null) {
      toast.error("Opening balance isn't a valid amount");
      return;
    }
    if (cents != null && cents !== 0 && !form.openingDate) {
      toast.error("Opening balance needs an as-of date");
      return;
    }
    startTransition(async () => {
      const result = await createBankAccountAction({
        name: form.name.trim(),
        kind: form.kind,
        institution: form.institution.trim() || undefined,
        last4: form.last4 || undefined,
        openingBalanceCents: cents,
        openingBalanceDate: form.openingDate || null,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Bank account added");
        setOpen(false);
        setForm({ name: "", kind: "checking", institution: "", last4: "", openingBalance: "", openingDate: "" });
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Landmark className="mr-1.5 size-4" /> Add manually
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a bank account</DialogTitle>
            <DialogDescription>
              Creates the register and its ledger account. Use CSV import (or
              connect via Plaid later) to feed it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ba-name">Name</Label>
                <Input
                  id="ba-name"
                  value={form.name}
                  placeholder="Chase Operating"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select
                  value={form.kind}
                  onValueChange={(v) =>
                    setForm({ ...form, kind: v as typeof form.kind })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="checking">Checking</SelectItem>
                    <SelectItem value="savings">Savings</SelectItem>
                    <SelectItem value="credit_card">Credit card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ba-inst">Institution (optional)</Label>
                <Input
                  id="ba-inst"
                  value={form.institution}
                  onChange={(e) => setForm({ ...form, institution: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ba-last4">Last 4 digits (optional)</Label>
                <Input
                  id="ba-last4"
                  value={form.last4}
                  maxLength={4}
                  onChange={(e) =>
                    setForm({ ...form, last4: e.target.value.replace(/\D/g, "") })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ba-obal">
                  {form.kind === "credit_card" ? "Amount owed" : "Opening balance"}{" "}
                  (optional)
                </Label>
                <Input
                  id="ba-obal"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.openingBalance}
                  onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ba-odate">As of</Label>
                <Input
                  id="ba-odate"
                  type="date"
                  value={form.openingDate}
                  onChange={(e) => setForm({ ...form, openingDate: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !form.name.trim()}>
              {pending ? "Adding…" : "Add account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ------------------------------------------------------------ quick add

export function QuickAddButton({
  bankAccounts,
  categories,
}: {
  bankAccounts: BankAccountOption[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    bankAccountId: bankAccounts[0]?.id ?? "",
    direction: "expense" as "expense" | "income",
    date: "",
    categoryAccountId: "",
    amount: "",
    memo: "",
  });

  const categoryPool = categories.filter((c) =>
    form.direction === "expense"
      ? c.accountType === "expense"
      : c.accountType === "income",
  );

  function submit() {
    const cents = parseMoneyToCents(form.amount);
    if (cents === null || cents === 0) {
      toast.error("Enter a valid amount");
      return;
    }
    startTransition(async () => {
      const result = await quickAddTransactionAction({
        bankAccountId: form.bankAccountId,
        direction: form.direction,
        txnDate: form.date,
        categoryAccountId: form.categoryAccountId,
        amountCents: cents,
        memo: form.memo.trim() || undefined,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Transaction added");
        setOpen(false);
        setForm((f) => ({ ...f, amount: "", memo: "" }));
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> Quick add
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quick add</DialogTitle>
            <DialogDescription>
              Record money in or out without waiting for the bank feed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Direction</Label>
                <Select
                  value={form.direction}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      direction: v as typeof form.direction,
                      categoryAccountId: "",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Money out (expense)</SelectItem>
                    <SelectItem value="income">Money in (income)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qa-date">Date</Label>
                <Input
                  id="qa-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Bank account</Label>
              <Select
                value={form.bankAccountId || undefined}
                onValueChange={(v) => setForm({ ...form, bankAccountId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={form.categoryAccountId || undefined}
                  onValueChange={(v) => setForm({ ...form, categoryAccountId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryPool.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qa-amount">Amount</Label>
                <Input
                  id="qa-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qa-memo">Memo (optional)</Label>
              <Input
                id="qa-memo"
                value={form.memo}
                onChange={(e) => setForm({ ...form, memo: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={submit}
              disabled={
                pending || !form.bankAccountId || !form.categoryAccountId || !form.date
              }
            >
              {pending ? "Saving…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ------------------------------------------------- Plaid connection card

export function PlaidConnectionCard({
  item,
  canManage,
}: {
  item: {
    plaidItemId: string;
    institutionName: string;
    status: string;
    lastSyncedAt: string | null;
    linkedAccounts: string[];
  };
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function sync() {
    startTransition(async () => {
      const result = await syncPlaidItemAction({ plaidItemId: item.plaidItemId });
      if ("error" in result) toast.error(result.error);
      else {
        const { added, modified, removed } = result.data!;
        toast.success(`Synced: ${added} new, ${modified} updated, ${removed} removed`);
        router.refresh();
      }
    });
  }

  function disconnect() {
    if (!window.confirm(`Disconnect ${item.institutionName}? History stays; the feed stops.`)) {
      return;
    }
    startTransition(async () => {
      const result = await disconnectPlaidItemAction({ plaidItemId: item.plaidItemId });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Disconnected");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{item.institutionName}</CardTitle>
          {item.status === "error" ? (
            <Badge variant="destructive">reconnect needed</Badge>
          ) : (
            <Badge className="bg-emerald-600 hover:bg-emerald-600">connected</Badge>
          )}
        </div>
        <CardDescription>
          {item.linkedAccounts.length > 0
            ? item.linkedAccounts.join(" · ")
            : "No registers linked"}
          {item.lastSyncedAt
            ? ` · last synced ${new Date(item.lastSyncedAt).toLocaleString()}`
            : " · never synced"}
        </CardDescription>
      </CardHeader>
      {canManage && (
        <CardContent className="flex gap-2">
          <Button size="sm" variant="outline" onClick={sync} disabled={pending}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {pending ? "Syncing…" : "Sync now"}
          </Button>
          <Button size="sm" variant="ghost" onClick={disconnect} disabled={pending}>
            <Unplug className="mr-1.5 size-3.5" /> Disconnect
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
