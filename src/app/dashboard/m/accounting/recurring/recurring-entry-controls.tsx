"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Play, Trash2 } from "lucide-react";
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
  updateRecurringEntryAction,
} from "@/modules/accounting/recurring/actions";
import {
  journalTemplateImbalanceCents,
  type RecurringEntryTemplate,
} from "@/modules/accounting/recurring/template";
import {
  DimensionTags,
  type DimensionTypeOption,
} from "@/components/app/dimension-tags";
import {
  formatCents,
  formatCentsSigned,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface PartyOption {
  id: string;
  name: string;
}

/** One row of an invoice template — its own shape, because an invoice line
 *  carries a quantity and a unit price where a bill line carries a total. */
type InvoiceTemplateLine = Extract<RecurringEntryTemplate, { kind: "invoice" }>["lines"][number];
type JournalTemplateLine = Extract<RecurringEntryTemplate, { kind: "journal" }>["lines"][number];
type BillTemplateLine = Extract<RecurringEntryTemplate, { kind: "bill" }>["lines"][number];

interface InvoiceRow {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  incomeAccountId: string;
  /**
   * **REQUIRED, NOT OPTIONAL.** The round-trip rule that made this required on
   * the invoice, bill and journal builders has a target here now: an existing
   * template is read back into this form, carried, and sent again — so a row
   * shape that could omit it would wipe every tag on the first edit. Required
   * puts every construction site in front of the compiler.
   */
  dimensionMemberIds: string[];
  /**
   * **THE LINE AS STORED, when editing.** Edits are OVERLAID on it at submit
   * rather than rebuilding the line from what this form renders — so a field
   * the dialog has no control for (`isTaxable`, a line `memo`) survives a save
   * without a rule resting on "no writer exists for it".
   */
  loaded?: InvoiceTemplateLine;
}

const emptyInvoiceRow = (): InvoiceRow => ({
  key: crypto.randomUUID(),
  description: "",
  quantity: "1",
  unitPrice: "",
  incomeAccountId: "",
  dimensionMemberIds: [],
});

const invoiceRowFrom = (l: InvoiceTemplateLine): InvoiceRow => ({
  key: crypto.randomUUID(),
  description: l.description,
  quantity: l.quantity,
  unitPrice: formatCents(l.unitPriceCents).replaceAll(",", ""),
  incomeAccountId: l.incomeAccountId,
  dimensionMemberIds: l.dimensionMemberIds ?? [],
  loaded: l,
});

interface JournalRow {
  key: string;
  accountId: string;
  amount: string;
  credit: boolean;
  /** See `InvoiceRow.dimensionMemberIds`. */
  dimensionMemberIds: string[];
  /** See `InvoiceRow.loaded`. */
  loaded?: JournalTemplateLine;
}

const emptyRow = (accountId: string): JournalRow => ({
  key: crypto.randomUUID(),
  accountId,
  amount: "",
  credit: false,
  dimensionMemberIds: [],
});

const journalRowFrom = (l: JournalTemplateLine): JournalRow => ({
  key: crypto.randomUUID(),
  accountId: l.accountId,
  amount: formatCents(Math.abs(l.amountCents)).replaceAll(",", ""),
  credit: l.amountCents < 0,
  dimensionMemberIds: l.dimensionMemberIds ?? [],
  loaded: l,
});

/** What the list hands the dialog to edit. Parsed by the page; a broken row gets no Edit. */
export interface ExistingRecurringEntry {
  id: string;
  version: number;
  kind: "invoice" | "bill" | "journal";
  name: string;
  dayOfMonth: number;
  nextRunDate: string;
  autoPost: boolean;
  vendorId: string | null;
  customerId: string | null;
  template: RecurringEntryTemplate;
}

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
      const { created, periodsWalked, posted, deferredToDraft, tagsDropped, errors } =
        result.data!;
      /**
       * **"NOTHING WAS DUE" IS A QUESTION ABOUT PERIODS, NOT ABOUT RECORDS.**
       *
       * This read `created === 0`, which was an EXACT test while `created` was
       * the period count: a template only reaches the loop when
       * `next_run_date <= today`, so any template that ran without throwing
       * contributed at least one. Gating the counters on `deduped` broke that
       * equivalence — a due template whose every period was already there now
       * writes nothing while having walked three months.
       *
       * Left alone it would have swallowed the retired-tag warning below,
       * which is the one thing on this screen that says a template needs
       * fixing. `periodsWalked` is used here and nowhere else in the UI; the
       * number itself is never shown.
       */
      if (periodsWalked === 0 && errors === 0) {
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
                // Named here because nothing else ever will: there is no
                // last-error column, the sweep reports counts only (S9), and
                // the list's "template needs fixing" badge is a SHAPE check
                // that a retired tag does not trip.
                tagsDropped > 0
                  ? `${tagsDropped} tag${tagsDropped === 1 ? "" : "s"} dropped — the member was retired`
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
 * Creating — or, since 2026-09-01, editing — a recurring invoice, bill or
 * journal. One dialog per row when editing, the `VendorDialogButton` shape.
 *
 * The journal side shows a running imbalance as you type, because an entry
 * that does not balance is refused at save — and finding that out after
 * filling in six lines, from a red toast, is a worse way to learn it than a
 * number that is visibly not zero.
 *
 * **EDIT IS AN OVERLAY, NOT A REBUILD.** Every row keeps the line as stored
 * (`loaded`) and the template keeps its stored top level, and submit spreads
 * those first and the edited fields over them. So `memo`, `entityId`,
 * `taxRateId`, a line's `isTaxable` — none of which this dialog has a control
 * for — survive a save that changed only an amount.
 */
export function RecurringEntryDialogButton({
  journalAccounts,
  incomeAccounts,
  codableAccounts,
  vendors,
  customers,
  today,
  dimensionTypes = [],
  existing,
}: {
  /** A journal may touch anything. */
  journalAccounts: AccountOption[];
  /** An invoice line posts revenue, so income only — same as the builder. */
  incomeAccounts: AccountOption[];
  /** A bill line: no bank register, no opening balance, no system AR/AP. */
  codableAccounts: AccountOption[];
  vendors: PartyOption[];
  customers: PartyOption[];
  today: string;
  /**
   * Active members grouped by type, from `dimensionTypesFrom`. Empty renders no
   * tag control at all.
   *
   * When CREATING, no `keepIds`: every member offered is one somebody is
   * choosing today. When EDITING, the page passes that template's own ids as
   * `keepIds`, so a retired member the template already holds is offered,
   * marked, and can be taken off — the same reason the invoice and bill edit
   * pages do it. A save that still names a retired member is refused, so the
   * only way to save is to see the tag and remove it.
   */
  dimensionTypes?: DimensionTypeOption[];
  /** When set, the dialog edits this template instead of creating one. */
  existing?: ExistingRecurringEntry;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const stored = existing?.template;
  const storedBill = stored?.kind === "bill" ? stored.lines[0] : undefined;
  // `kind` is FIXED once a template exists — the database ties party to kind
  // and invoices point back at an invoice template. The select is hidden.
  const [kind, setKind] = useState<"invoice" | "bill" | "journal">(
    existing?.kind ?? "invoice",
  );
  const [name, setName] = useState(existing?.name ?? "");
  const [dayOfMonth, setDayOfMonth] = useState(String(existing?.dayOfMonth ?? 1));
  const [nextRunDate, setNextRunDate] = useState(existing?.nextRunDate ?? today);
  const [autoPost, setAutoPost] = useState(existing?.autoPost ?? false);
  const [vendorId, setVendorId] = useState(existing?.vendorId ?? vendors[0]?.id ?? "");
  const [customerId, setCustomerId] = useState(
    existing?.customerId ?? customers[0]?.id ?? "",
  );
  const [dueInDays, setDueInDays] = useState(
    String(stored && stored.kind !== "journal" ? stored.dueInDays : 30),
  );
  const [rows, setRows] = useState<JournalRow[]>(
    stored?.kind === "journal"
      ? stored.lines.map(journalRowFrom)
      : [emptyRow(journalAccounts[0]?.id ?? ""), emptyRow(journalAccounts[0]?.id ?? "")],
  );
  const [billDesc, setBillDesc] = useState(storedBill?.description ?? "");
  const [billAmount, setBillAmount] = useState(
    storedBill ? formatCents(storedBill.amountCents).replaceAll(",", "") : "",
  );
  const [billAccountId, setBillAccountId] = useState(storedBill?.accountId ?? "");
  /**
   * **ONE TAG FOR THE WHOLE BILL TEMPLATE, and that is the shape, not a
   * shortcut.** This dialog builds a bill template of exactly one line
   * (`submit()` below), so per-line and per-template are the same object here.
   * Making it an array of rows to get a per-line tag would be a bill-template
   * feature — "a recurring bill can have more than one line" — riding along in
   * a tagging change, and it would land a new row grid inside a dialog that has
   * no horizontal overflow to give it.
   */
  const [billTags, setBillTags] = useState<string[]>(
    storedBill?.dimensionMemberIds ?? [],
  );
  const [invoiceRows, setInvoiceRows] = useState<InvoiceRow[]>(
    stored?.kind === "invoice" ? stored.lines.map(invoiceRowFrom) : [emptyInvoiceRow()],
  );

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

    // Undefined rather than an empty array, and set AFTER the overlay: the
    // field is optional in the schema, an absent one stores nothing, and a
    // tag the person just took off must not come back from the stored line.
    const tags = (ids: string[]) => (ids.length ? ids : undefined);

    const template: RecurringEntryTemplate =
      kind === "journal"
        ? {
            ...(stored?.kind === "journal" ? stored : {}),
            kind: "journal" as const,
            lines: usable.map((p) => ({
              ...(p.row.loaded ?? {}),
              accountId: p.row.accountId,
              amountCents: p.cents!,
              dimensionMemberIds: tags(p.row.dimensionMemberIds),
            })),
          }
        : kind === "invoice"
          ? {
              ...(stored?.kind === "invoice" ? stored : {}),
              kind: "invoice" as const,
              dueInDays: Number(dueInDays) || 0,
              lines: invoiceRows.map((r) => ({
                ...(r.loaded ?? {}),
                description: r.description.trim(),
                quantity: r.quantity.trim(),
                unitPriceCents: parseMoneyToCents(r.unitPrice) ?? 0,
                incomeAccountId: r.incomeAccountId,
                dimensionMemberIds: tags(r.dimensionMemberIds),
              })),
            }
          : {
              ...(stored?.kind === "bill" ? stored : {}),
              kind: "bill" as const,
              dueInDays: Number(dueInDays) || 0,
              lines: [
                {
                  ...((storedBill ?? {}) as Partial<BillTemplateLine>),
                  description: billDesc.trim(),
                  amountCents: parseMoneyToCents(billAmount) ?? 0,
                  accountId: billAccountId || null,
                  dimensionMemberIds: tags(billTags),
                },
              ],
            };

    const payload = {
      name: name.trim(),
      vendorId: kind === "bill" ? vendorId : null,
      customerId: kind === "invoice" ? customerId : null,
      dayOfMonth: day,
      nextRunDate,
      autoPost: kind === "journal" ? autoPost : false,
      template,
    };

    startTransition(async () => {
      const result = existing
        ? await updateRecurringEntryAction({
            ...payload,
            id: existing.id,
            expectedVersion: existing.version,
          })
        : await createRecurringEntryAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(existing ? `Recurring ${kind} updated` : `Recurring ${kind} added`);
      setOpen(false);
      router.refresh();
    });
  }

  const canSubmit =
    name.trim() !== "" &&
    (kind === "journal"
      ? usable.length >= 2 && imbalance === 0
      : kind === "invoice"
        ? customerId !== "" &&
          invoiceRows.length > 0 &&
          invoiceRows.every(
            (r) =>
              r.incomeAccountId !== "" &&
              /^\d{1,10}(\.\d{1,2})?$/.test(r.quantity.trim()) &&
              Number(r.quantity) > 0 &&
              parseMoneyToCents(r.unitPrice) !== null,
          )
        : vendorId !== "" &&
          billDesc.trim() !== "" &&
          parseMoneyToCents(billAmount) !== null);

  return (
    <>
      {existing ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Pencil className="mr-1.5 size-4" /> Edit
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Add recurring
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {existing ? "Edit recurring entry" : "Add a recurring entry"}
            </DialogTitle>
            <DialogDescription>
              {existing
                ? "Changes apply from the next run. It cannot move to an earlier month than the schedule has reached."
                : "Runs once a month. Catch-up creates one entry per missed month, dated to that month rather than to today."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-1">
            <div className="grid gap-3 sm:grid-cols-3">
              {!existing && (
                <div className="space-y-1.5">
                  <Label htmlFor="rec-kind">Type</Label>
                  <Select
                    value={kind}
                    onValueChange={(v) =>
                      setKind(v as "invoice" | "bill" | "journal")
                    }
                  >
                    <SelectTrigger id="rec-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="invoice">Invoice</SelectItem>
                      <SelectItem value="bill">Bill</SelectItem>
                      <SelectItem value="journal">Journal entry</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className={existing ? "space-y-1.5 sm:col-span-3" : "space-y-1.5 sm:col-span-2"}>
                <Label htmlFor="rec-name">Name</Label>
                <Input
                  id="rec-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    kind === "journal"
                      ? "Monthly depreciation"
                      : kind === "invoice"
                        ? "Unit 4 rent"
                        : "Yard rent"
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
                <Label htmlFor="rec-next">{existing ? "Next run" : "First run"}</Label>
                <Input
                  id="rec-next"
                  type="date"
                  value={nextRunDate}
                  onChange={(e) => setNextRunDate(e.target.value)}
                />
              </div>
              {kind !== "journal" && (
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
                  <div key={row.key} className="space-y-1">
                  <div className="flex items-end gap-2">
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
                          {journalAccounts.map((a) => (
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
                  {/*
                    A SUB-ROW, not a column. The dialog is `sm:max-w-2xl` with
                    vertical scroll only — unlike the three one-off builders it
                    has no `overflow-x-auto` to widen into, so a tag column
                    would have to be paid for by re-proportioning the row for
                    every tenant, including the ones with no dimensions who see
                    nothing here at all.
                  */}
                  {dimensionTypes.length > 0 && (
                    <div className="pl-1">
                      <DimensionTags
                        types={dimensionTypes}
                        value={row.dimensionMemberIds}
                        onValue={(v) => {
                          const next = [...rows];
                          next[i] = { ...row, dimensionMemberIds: v };
                          setRows(next);
                        }}
                        triggerClassName="h-7 px-2 text-xs font-normal text-muted-foreground"
                      />
                    </div>
                  )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRows([...rows, emptyRow(journalAccounts[0]?.id ?? "")])
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
            ) : kind === "invoice" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rec-customer">Customer</Label>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger id="rec-customer">
                      <SelectValue placeholder="Pick a customer" />
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
                <div className="space-y-2">
                  <Label>Lines</Label>
                  {invoiceRows.map((row, i) => (
                    <div key={row.key} className="space-y-1">
                    <div className="grid gap-2 sm:grid-cols-12">
                      <Input
                        className="sm:col-span-4"
                        value={row.description}
                        onChange={(e) => {
                          const next = [...invoiceRows];
                          next[i] = { ...row, description: e.target.value };
                          setInvoiceRows(next);
                        }}
                        placeholder="Description"
                        aria-label={`Description for line ${i + 1}`}
                      />
                      <Input
                        className="sm:col-span-1"
                        value={row.quantity}
                        onChange={(e) => {
                          const next = [...invoiceRows];
                          next[i] = { ...row, quantity: e.target.value };
                          setInvoiceRows(next);
                        }}
                        inputMode="decimal"
                        aria-label={`Quantity for line ${i + 1}`}
                      />
                      <Input
                        className="sm:col-span-2"
                        value={row.unitPrice}
                        onChange={(e) => {
                          const next = [...invoiceRows];
                          next[i] = { ...row, unitPrice: e.target.value };
                          setInvoiceRows(next);
                        }}
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-label={`Unit price for line ${i + 1}`}
                      />
                      <div className="sm:col-span-4">
                        <Select
                          value={row.incomeAccountId}
                          onValueChange={(v) => {
                            const next = [...invoiceRows];
                            next[i] = { ...row, incomeAccountId: v };
                            setInvoiceRows(next);
                          }}
                        >
                          <SelectTrigger aria-label={`Income account for line ${i + 1}`}>
                            <SelectValue placeholder="Income account" />
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="sm:col-span-1"
                        disabled={invoiceRows.length <= 1}
                        onClick={() =>
                          setInvoiceRows(invoiceRows.filter((_, j) => j !== i))
                        }
                        aria-label={`Remove line ${i + 1}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    {/* The 12 columns above are exactly spent (4+1+2+4+1), so
                        a tag column means re-proportioning all five. */}
                    {dimensionTypes.length > 0 && (
                      <div className="pl-1">
                        <DimensionTags
                          types={dimensionTypes}
                          value={row.dimensionMemberIds}
                          onValue={(v) => {
                            const next = [...invoiceRows];
                            next[i] = { ...row, dimensionMemberIds: v };
                            setInvoiceRows(next);
                          }}
                          triggerClassName="h-7 px-2 text-xs font-normal text-muted-foreground"
                        />
                      </div>
                    )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setInvoiceRows([...invoiceRows, emptyInvoiceRow()])}
                  >
                    <Plus className="mr-1.5 size-4" /> Add line
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Invoices are always created as drafts — issuing one is what
                  posts it and starts the clock on getting paid.
                </p>
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
                      {codableAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {dimensionTypes.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>Tags (optional)</Label>
                    <DimensionTags
                      types={dimensionTypes}
                      value={billTags}
                      onValue={setBillTags}
                      triggerClassName="w-full justify-start font-normal"
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Bills are always created as drafts — approving one is what
                  posts it.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={submit} disabled={pending || !canSubmit}>
              {pending
                ? existing
                  ? "Saving…"
                  : "Adding…"
                : existing
                  ? "Save changes"
                  : "Add recurring"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
