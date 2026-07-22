"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import {
  Copy,
  Landmark,
  Link2,
  Loader2,
  Mail,
  Paperclip,
  ReceiptText,
  RotateCcw,
  ScanText,
  Trash2,
  Upload,
} from "lucide-react";
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
  UPLOAD_ACCEPT_ATTR,
  isAllowedUpload,
} from "@/modules/accounting/documents/allowlist";
import {
  attachDocumentAction,
  disableEmailInAction,
  enableEmailInAction,
  extractDocumentAction,
  findMatchCandidatesAction,
  listAttachTargetsAction,
  recordExpenseFromReceiptAction,
  regenerateEmailInTokenAction,
  registerUploadedDocumentAction,
  restoreDocumentAction,
  trashDocumentAction,
} from "@/modules/accounting/documents/actions";
import {
  formatCents,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  accountType: string;
  subtype: string;
}

export interface DocumentRowData {
  id: string;
  fileName: string;
  mimeType: string;
  source: "upload" | "email";
  emailFrom: string;
  status: "inbox" | "filed" | "trashed";
  version: number;
  createdAt: string;
  hasBlob: boolean;
  extractionStatus: "pending" | "done" | "failed" | "skipped";
  vendorName: string | null;
  totalCents: number | null;
  documentDate: string | null;
  docType: string | null;
}

// ---------------------------------------------------------------- upload

export function UploadButton({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (!isAllowedUpload(file.type, file.size)) {
          toast.error(
            `${file.name}: that file type or size isn't supported — JPEG, PNG, WebP, GIF or PDF up to 20MB.`,
          );
          continue;
        }
        const blob = await upload(
          `acct/${tenantId}/receipts/${file.name}`,
          file,
          {
            access: "private",
            handleUploadUrl: "/api/blob/upload",
          },
        );
        const result = await registerUploadedDocumentAction({
          pathname: blob.pathname,
        });
        if ("error" in result) {
          toast.error(`${file.name}: ${result.error}`);
        } else if (result.data?.duplicateOfId) {
          toast.warning(
            `${file.name} uploaded — looks like a duplicate of a receipt you already have.`,
          );
        } else {
          toast.success(`${file.name} uploaded.`);
        }
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error("Upload failed. Please try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT_ATTR}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-2 h-4 w-4" />
        )}
        Upload
      </Button>
    </>
  );
}

// --------------------------------------------------------------- email-in

export function EmailInCard({
  address,
  configured,
}: {
  address: string | null;
  configured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ error?: string } | { ok: true }>) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result && result.error) toast.error(result.error);
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" /> Email-in
        </CardTitle>
        <CardDescription>
          {address
            ? "Forward bills and receipts to this address — attachments land in the inbox automatically."
            : configured
              ? "Turn on a private forwarding address for this business."
              : "Email-in isn't configured on this deployment yet (INBOUND_EMAIL_DOMAIN)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {address ? (
          <>
            <code className="rounded bg-muted px-2 py-1 text-xs">{address}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(address);
                toast.success("Address copied.");
              }}
            >
              <Copy className="mr-1 h-3.5 w-3.5" /> Copy
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (
                  confirm(
                    "Generate a new address? The old one stops working immediately.",
                  )
                )
                  run(regenerateEmailInTokenAction);
              }}
            >
              Regenerate
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (confirm("Disable email-in? The address stops working."))
                  run(disableEmailInAction);
              }}
            >
              Disable
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={pending || !configured}
            onClick={() => run(enableEmailInAction)}
          >
            Enable email-in
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------ row actions

export function DocumentRowActions({
  row,
  accounts,
  isOwner,
}: {
  row: DocumentRowData;
  accounts: AccountOption[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [attachOpen, setAttachOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);

  function run(fn: () => Promise<{ error?: string } | { ok: true }>, done?: string) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result && result.error) toast.error(result.error);
      else {
        if (done) toast.success(done);
        router.refresh();
      }
    });
  }

  if (row.status === "trashed") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(
            () =>
              restoreDocumentAction({
                documentId: row.id,
                expectedVersion: row.version,
              }),
            "Restored to inbox.",
          )
        }
      >
        <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      {row.hasBlob &&
        (row.extractionStatus === "pending" ||
          row.extractionStatus === "failed") && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(
                () => extractDocumentAction({ documentId: row.id }),
                "Document read.",
              )
            }
          >
            <ScanText className="mr-1 h-3.5 w-3.5" /> Read
          </Button>
        )}
      <Button size="sm" variant="outline" onClick={() => setAttachOpen(true)}>
        <Paperclip className="mr-1 h-3.5 w-3.5" /> Attach
      </Button>
      {isOwner && row.status === "inbox" && (
        <Button size="sm" variant="outline" onClick={() => setExpenseOpen(true)}>
          <ReceiptText className="mr-1 h-3.5 w-3.5" /> Record expense
        </Button>
      )}
      {row.status === "inbox" && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                trashDocumentAction({
                  documentId: row.id,
                  expectedVersion: row.version,
                }),
              "Moved to trash.",
            )
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
      <AttachDialog
        row={row}
        open={attachOpen}
        onOpenChange={setAttachOpen}
      />
      <RecordExpenseDialog
        row={row}
        accounts={accounts}
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
      />
    </span>
  );
}

// ----------------------------------------------------------- attach dialog

interface Candidate {
  transactionId: string;
  bankAccountId: string;
  bankAccountName: string;
  txnDate: string;
  description: string;
  amountCents: number;
}

interface AttachTargets {
  entries: Array<{ id: string; entryDate: string; memo: string; status: string }>;
  invoices: Array<{ id: string; invoiceNumber: string; status: string }>;
}

export function AttachDialog({
  row,
  open,
  onOpenChange,
}: {
  row: DocumentRowData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [targets, setTargets] = useState<AttachTargets | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open || loadedFor.current === row.id) return;
    loadedFor.current = row.id;
    void (async () => {
      const [candidatesResult, targetsResult] = await Promise.all([
        findMatchCandidatesAction({ documentId: row.id }),
        listAttachTargetsAction(),
      ]);
      setCandidates(
        "error" in candidatesResult ? [] : (candidatesResult.data?.candidates ?? []),
      );
      setTargets("error" in targetsResult ? null : (targetsResult.data ?? null));
    })();
  }, [open, row.id]);

  function attach(
    target: { type: "entry" | "bank_transaction" | "invoice"; id: string },
    onDone?: () => void,
  ) {
    startTransition(async () => {
      const result = await attachDocumentAction({ documentId: row.id, target });
      if ("error" in result && result.error) toast.error(result.error);
      else {
        toast.success("Document attached.");
        onOpenChange(false);
        onDone?.();
        router.refresh();
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) loadedFor.current = null;
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach document</DialogTitle>
          <DialogDescription>
            {row.vendorName ?? row.fileName}
            {row.totalCents !== null &&
              ` · $${formatCents(Math.abs(row.totalCents))}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Landmark className="mr-1 inline h-3 w-3" />
              Matching bank transactions
            </p>
            {candidates === null ? (
              <p className="text-sm text-muted-foreground">Looking…</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {row.totalCents === null
                  ? "Read the receipt first to get match suggestions."
                  : "No unreviewed bank transactions match this amount and date."}
              </p>
            ) : (
              <div className="divide-y rounded-md border">
                {candidates.map((c) => (
                  <button
                    key={c.transactionId}
                    type="button"
                    disabled={pending}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                    onClick={() =>
                      attach(
                        { type: "bank_transaction", id: c.transactionId },
                        () =>
                          router.push(
                            `/dashboard/m/accounting/banking/${c.bankAccountId}?focus=${c.transactionId}`,
                          ),
                      )
                    }
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {c.description || "(no description)"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {c.bankAccountName} · {c.txnDate}
                      </span>
                    </span>
                    <Badge variant="secondary" className="font-mono">
                      {c.amountCents < 0 ? "−" : ""}$
                      {formatCents(Math.abs(c.amountCents))}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Link2 className="mr-1 inline h-3 w-3" />
              Or attach to a record
            </p>
            {targets === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  disabled={pending || targets.entries.length === 0}
                  onValueChange={(id) => attach({ type: "entry", id })}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        targets.entries.length === 0
                          ? "No journal entries"
                          : "Journal entry…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.entries.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.entryDate} · {e.memo || "(no memo)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  disabled={pending || targets.invoices.length === 0}
                  onValueChange={(id) => attach({ type: "invoice", id })}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        targets.invoices.length === 0
                          ? "No invoices"
                          : "Invoice…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.invoices.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.invoiceNumber} · {i.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------- record expense dialog

export function RecordExpenseDialog({
  row,
  accounts,
  open,
  onOpenChange,
}: {
  row: DocumentRowData;
  accounts: AccountOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState(
    row.totalCents !== null ? formatCents(Math.abs(row.totalCents)).replace(/,/g, "") : "",
  );
  const [date, setDate] = useState(
    row.documentDate ?? row.createdAt.slice(0, 10),
  );
  const [memo, setMemo] = useState(row.vendorName ?? "");
  const [paidFrom, setPaidFrom] = useState("");
  const [category, setCategory] = useState("");

  const paidFromOptions = accounts.filter(
    (a) =>
      a.subtype === "bank" ||
      a.subtype === "cash" ||
      a.subtype === "credit_card",
  );
  const categoryOptions = accounts.filter(
    (a) => a.accountType === "expense" || a.accountType === "income",
  );

  function submit() {
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (!paidFrom || !category) {
      toast.error("Pick both accounts.");
      return;
    }
    startTransition(async () => {
      const result = await recordExpenseFromReceiptAction({
        documentId: row.id,
        entryDate: date,
        amountCents: cents,
        memo: memo || undefined,
        paidFromAccountId: paidFrom,
        categoryAccountId: category,
      });
      if ("error" in result && result.error) toast.error(result.error);
      else {
        toast.success("Expense recorded and receipt attached.");
        onOpenChange(false);
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record expense</DialogTitle>
          <DialogDescription>
            Posts a journal entry from this document and attaches it — for cash
            or out-of-feed purchases.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`amt-${row.id}`}>Amount</Label>
              <Input
                id={`amt-${row.id}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`date-${row.id}`}>Date</Label>
              <Input
                id={`date-${row.id}`}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`memo-${row.id}`}>Memo</Label>
            <Input
              id={`memo-${row.id}`}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Vendor / what it was"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Paid from</Label>
            <Select value={paidFrom} onValueChange={setPaidFrom}>
              <SelectTrigger>
                <SelectValue placeholder="Bank, cash, or card account" />
              </SelectTrigger>
              <SelectContent>
                {paidFromOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Expense category" />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
