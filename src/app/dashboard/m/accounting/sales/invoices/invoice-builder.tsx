"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DimensionTags,
  type DimensionTypeOption,
} from "@/components/app/dimension-tags";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  createInvoiceDraftAction,
  updateInvoiceDraftAction,
} from "@/modules/accounting/invoicing/actions";
import {
  lineAmountCents,
  parseQuantityHundredths,
} from "@/modules/accounting/invoicing/lines";
import {
  formatCentsSigned,
  parseMoneyToCents,
} from "@/modules/accounting/lib/money";
import {
  describeTerm,
  dueDateFromTerms,
  resolveTerm,
  type TermLike,
} from "@/modules/accounting/invoicing/terms";
import {
  formatRatePpm,
  invoiceTaxTotals,
  resolveTaxRate,
  type TaxRateLike,
} from "@/modules/accounting/invoicing/tax";

export interface BuilderCustomer {
  id: string;
  name: string;
}

export interface BuilderAccount {
  id: string;
  code: string;
  name: string;
}

/** A saved line: picking one fills description, price and account at once. */
export interface BuilderProduct {
  id: string;
  name: string;
  description: string;
  unitPriceCents: number;
  incomeAccountId: string | null;
}

interface LineRow {
  key: string;
  description: string;
  quantity: string;
  /** Raw money string; sign toggle below. */
  unitPrice: string;
  discount: boolean;
  taxable: boolean;
  incomeAccountId: string;
  /**
   * **REQUIRED, NOT OPTIONAL, AND THAT IS THE POINT.** `updateInvoiceDraft`
   * whole-replaces the lines and their dimensions cascade with them, so a row
   * shape that could omit this would silently wipe a tag on the first edit of a
   * tagged draft. Making it required puts every construction site — three of
   * them, including the saved-item picker — in front of the compiler.
   */
  dimensionMemberIds: string[];
}

export interface BuilderInvoice {
  id: string;
  version: number;
  /** Read-only once the draft exists — the company is fixed at creation. */
  entityId?: string;
  customerId: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  memo: string;
  taxRateId: string | null;
  lines: Array<{
    description: string;
    quantity: string;
    unitPriceCents: number;
    isTaxable: boolean;
    incomeAccountId: string;
    /** `loadInvoiceLines` already returns these; the page passes them through. */
    dimensionMemberIds: string[];
  }>;
}

/**
 * A NEW line defaults to taxable when the invoice has a rate on it.
 *
 * The alternative — every line starting untaxed — means an owner who picked a
 * rate then has to tick each line, and the failure mode of forgetting is an
 * invoice that under-charges tax. Defaulting the other way makes the failure
 * mode an over-charge somebody notices immediately on the total.
 */
function emptyRow(defaultAccount: string, taxable: boolean): LineRow {
  return {
    key: crypto.randomUUID(),
    description: "",
    quantity: "1",
    unitPrice: "",
    discount: false,
    taxable,
    incomeAccountId: defaultAccount,
    dimensionMemberIds: [],
  };
}

export function InvoiceBuilder({
  customers,
  entities = [],
  defaultEntityId = null,
  incomeAccounts,
  suggestedNumber,
  today,
  invoice,
  products = [],
  terms = [],
  defaultTermId = null,
  taxRates = [],
  defaultTaxRateId = null,
  dimensionTypes = [],
}: {
  customers: BuilderCustomer[];
  /**
   * Active members, grouped by type, from `dimensionTypesFrom`. Empty renders
   * no tag control at all, which is most businesses.
   */
  dimensionTypes?: DimensionTypeOption[];
  /**
   * The tenant's companies (ADR 0010). Shown only at TWO or more — one company
   * and the client never learns the concept.
   *
   * Chosen once, on the DRAFT, and never editable afterwards: the company is
   * what issuance and every payment read, so changing it on a document that has
   * already posted would move money between two balance sheets.
   */
  entities?: Array<{ id: string; name: string }>;
  defaultEntityId?: string | null;
  incomeAccounts: BuilderAccount[];
  suggestedNumber: string;
  today: string;
  /** When set, edits this draft instead of creating. */
  invoice?: BuilderInvoice;
  products?: BuilderProduct[];
  terms?: TermLike[];
  /** The tenant's default term, applied to a NEW invoice only. */
  defaultTermId?: string | null;
  /** ACTIVE rates only. Empty means this tenant charges no sales tax, and
   * every tax control below disappears rather than sitting there empty. */
  taxRates?: TaxRateLike[];
  /** The tenant's default rate, applied to a NEW invoice only. */
  defaultTaxRateId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const defaultAccount = incomeAccounts[0]?.id ?? "";
  const [customerId, setCustomerId] = useState(invoice?.customerId ?? "");
  const [entityId, setEntityId] = useState(
    invoice?.entityId ?? defaultEntityId ?? "",
  );
  const [number, setNumber] = useState(invoice?.invoiceNumber ?? suggestedNumber);
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? today);
  // An EXISTING draft keeps the date it was saved with — re-deriving it from
  // terms on open would silently move a date somebody chose by hand.
  const initialTerm = invoice ? null : resolveTerm(terms, null, defaultTermId);
  const [termId, setTermId] = useState(initialTerm?.id ?? "");
  const [dueDate, setDueDate] = useState(
    invoice?.dueDate ??
      (initialTerm ? dueDateFromTerms(invoice?.issueDate ?? today, initialTerm.dueInDays) : ""),
  );

  const chosenTerm = terms.find((t) => t.id === termId) ?? null;

  /** Terms drive the date; typing a date directly clears the term. */
  function applyTerm(nextTermId: string) {
    setTermId(nextTermId);
    const term = terms.find((t) => t.id === nextTermId);
    if (term) setDueDate(dueDateFromTerms(issueDate, term.dueInDays));
  }

  /** Re-derive when the issue date moves, so the pair stays consistent. */
  function applyIssueDate(next: string) {
    setIssueDate(next);
    if (chosenTerm) setDueDate(dueDateFromTerms(next, chosenTerm.dueInDays));
  }
  const [memo, setMemo] = useState(invoice?.memo ?? "");
  // Same rule as terms: an EXISTING draft keeps the rate it was saved with, a
  // new one gets the tenant default.
  const initialRate = invoice
    ? (taxRates.find((r) => r.id === invoice.taxRateId) ?? null)
    : resolveTaxRate(taxRates, defaultTaxRateId);
  const [taxRateId, setTaxRateId] = useState(initialRate?.id ?? "");
  const chosenRate = taxRates.find((r) => r.id === taxRateId) ?? null;

  const [rows, setRows] = useState<LineRow[]>(
    invoice
      ? invoice.lines.map((l) => ({
          key: crypto.randomUUID(),
          description: l.description,
          quantity: l.quantity,
          unitPrice: (Math.abs(l.unitPriceCents) / 100).toFixed(2),
          discount: l.unitPriceCents < 0,
          taxable: l.isTaxable,
          incomeAccountId: l.incomeAccountId,
          // THE ROUND TRIP. Read back by `loadInvoiceLines`, carried through
          // the form, and sent again on save — because the update deletes every
          // line and re-inserts it, so anything not carried is deleted.
          dimensionMemberIds: l.dimensionMemberIds,
        }))
      : [emptyRow(defaultAccount, initialRate !== null)],
  );

  const parsed = rows.map((row) => {
    const qty = parseQuantityHundredths(row.quantity);
    const price = parseMoneyToCents(row.unitPrice);
    const priceCents = price === null ? null : row.discount ? -price : price;
    const valid = qty !== null && priceCents !== null && row.incomeAccountId !== "";
    return {
      row,
      valid,
      amountCents: valid ? lineAmountCents(qty!, priceCents!) : 0,
    };
  });
  const filled = parsed.filter(
    (p) => p.row.description.trim() !== "" || p.row.unitPrice.trim() !== "",
  );
  const allValid = filled.length > 0 && filled.every((p) => p.valid);
  // Not memoized: `filled` is rebuilt from `rows` on every render, so its
  // identity always changes and a useMemo keyed on it never once hit its cache
  // — it only stopped the compiler from memoizing this properly.
  //
  // THE SAME FUNCTION THE SERVER RECOMPUTES ON SAVE (`invoicing/tax.ts`). Two
  // implementations of this rule is how the number on screen and the number on
  // the invoice come to disagree.
  const totals = invoiceTaxTotals(
    filled.map((p) => ({ amountCents: p.amountCents, isTaxable: p.row.taxable })),
    chosenRate ? chosenRate.ratePpm : null,
  );

  // The per-line Tax column appears only once a rate is CHOSEN, not merely
  // because the tenant has rates: ticking lines on an untaxed invoice does
  // nothing, and a column that does nothing invites the belief that it did.
  const showTax = chosenRate !== null;

  /**
   * Turning tax ON ticks every line; turning it off leaves the flags alone.
   *
   * Choosing a rate means "tax this invoice"; the per-line flag exists for the
   * EXCEPTIONS. Without this, an owner whose tenant has rates but no default
   * picks one and watches the tax read 0.00 with every line unticked — the
   * control appearing to do nothing. Leaving the flags alone on the way back to
   * "No tax" is what makes switching to a rate and back non-destructive.
   */
  function applyTaxRate(nextRateId: string) {
    const wasOff = taxRateId === "";
    setTaxRateId(nextRateId);
    if (nextRateId !== "" && wasOff) {
      setRows((rs) => rs.map((r) => ({ ...r, taxable: true })));
    }
  }
  // Both class strings written out in full — Tailwind scans for literals, so a
  // template-built grid template would simply not be generated.
  const gridCols = showTax
    ? "grid grid-cols-[1fr_90px_120px_60px_50px_1fr_100px_32px]"
    : "grid grid-cols-[1fr_90px_120px_60px_1fr_100px_32px]";

  function setRow(key: string, patch: Partial<LineRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function submit() {
    const lines = filled.map((p) => {
      const price = parseMoneyToCents(p.row.unitPrice)!;
      return {
        description: p.row.description.trim(),
        quantity: p.row.quantity,
        unitPriceCents: p.row.discount ? -price : price,
        // Sent even when the invoice has no rate: the flag describes the LINE,
        // and keeping it means adding a rate later does not silently re-tick
        // every row from scratch.
        isTaxable: p.row.taxable,
        incomeAccountId: p.row.incomeAccountId,
        // Undefined rather than an empty array: the schema's field is optional
        // and an absent one writes no `line_dimensions` rows, which is what
        // untagged means.
        dimensionMemberIds: p.row.dimensionMemberIds.length
          ? p.row.dimensionMemberIds
          : undefined,
      };
    });
    startTransition(async () => {
      const payload = {
        entityId: entityId || undefined,
        customerId,
        invoiceNumber: number.trim() || undefined,
        issueDate,
        dueDate: dueDate || null,
        memo: memo.trim() || undefined,
        taxRateId: taxRateId || null,
        lines,
      };
      const result = invoice
        ? await updateInvoiceDraftAction({
            invoiceId: invoice.id,
            expectedVersion: invoice.version,
            patch: payload,
          })
        : await createInvoiceDraftAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(invoice ? "Draft updated" : "Draft saved");
      const id = invoice
        ? invoice.id
        : (result as { data?: { invoiceId: string } }).data!.invoiceId;
      router.push(`/dashboard/m/accounting/sales/invoices/${id}`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {!invoice && entities.length > 1 && (
          <div className="space-y-1.5 sm:max-w-xs">
            <Label>Company</Label>
            <Select value={entityId || undefined} onValueChange={setEntityId}>
              <SelectTrigger>
                <SelectValue placeholder="Which company is invoicing?" />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Customer</Label>
            <Select value={customerId || undefined} onValueChange={setCustomerId}>
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
          <div className="space-y-1.5">
            <Label htmlFor="inv-number">Number</Label>
            <Input
              id="inv-number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-issue">Issue date</Label>
            <Input
              id="inv-issue"
              type="date"
              value={issueDate}
              onChange={(e) => applyIssueDate(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {terms.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="inv-terms">Terms</Label>
              <Select value={termId} onValueChange={applyTerm}>
                <SelectTrigger id="inv-terms">
                  <SelectValue placeholder="Custom" />
                </SelectTrigger>
                <SelectContent>
                  {terms.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="inv-due">Due date (optional)</Label>
            <Input
              id="inv-due"
              type="date"
              value={dueDate}
              onChange={(e) => {
                // A hand-typed date is a deliberate override, so the term stops
                // claiming to describe it.
                setTermId("");
                setDueDate(e.target.value);
              }}
            />
            {chosenTerm && (
              <p className="text-xs text-muted-foreground">
                {describeTerm(chosenTerm, issueDate)}
              </p>
            )}
          </div>
          <div
            className={
              taxRates.length > 0 ? "space-y-1.5" : "space-y-1.5 sm:col-span-2"
            }
          >
            <Label htmlFor="inv-memo">Memo</Label>
            <Input
              id="inv-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Shown on the printed invoice"
            />
          </div>
          {/* Absent entirely for a tenant with no rates — a tax control that
              offers nothing is worse than no tax control. */}
          {taxRates.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="inv-tax">Sales tax</Label>
              <Select
                value={taxRateId || "none"}
                onValueChange={(v) => applyTaxRate(v === "none" ? "" : v)}
              >
                <SelectTrigger id="inv-tax">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No tax</SelectItem>
                  {taxRates.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} · {formatRatePpm(r.ratePpm)}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <div className={showTax ? "min-w-[700px] space-y-2" : "min-w-[640px] space-y-2"}>
            <div className={`${gridCols} items-center gap-2 text-xs font-medium text-muted-foreground`}>
              <span>Description</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit price</span>
              <span>Disc.</span>
              {showTax && <span title="Charge sales tax on this line">Tax</span>}
              <span>Income account</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            {rows.map((row) => {
              const p = parsed.find((x) => x.row.key === row.key)!;
              return (
                <div key={row.key} className="space-y-1">
                <div
                  className={`${gridCols} items-center gap-2`}
                >
                  <Input
                    className="h-9"
                    value={row.description}
                    placeholder="What was provided"
                    onChange={(e) => setRow(row.key, { description: e.target.value })}
                  />
                  <Input
                    inputMode="decimal"
                    className="h-9 text-right font-mono"
                    value={row.quantity}
                    onChange={(e) => setRow(row.key, { quantity: e.target.value })}
                  />
                  <Input
                    inputMode="decimal"
                    className="h-9 text-right font-mono"
                    placeholder="0.00"
                    value={row.unitPrice}
                    onChange={(e) => setRow(row.key, { unitPrice: e.target.value })}
                  />
                  <label className="flex justify-center">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={row.discount}
                      title="Discount line (negative)"
                      onChange={(e) => setRow(row.key, { discount: e.target.checked })}
                    />
                  </label>
                  {showTax && (
                    <label className="flex justify-center">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={row.taxable}
                        aria-label={`Charge sales tax on ${row.description || "this line"}`}
                        title="Charge sales tax on this line"
                        onChange={(e) => setRow(row.key, { taxable: e.target.checked })}
                      />
                    </label>
                  )}
                  <Select
                    value={row.incomeAccountId || undefined}
                    onValueChange={(v) => setRow(row.key, { incomeAccountId: v })}
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
                  <span className="text-right font-mono text-sm">
                    {p.valid ? formatCentsSigned(p.amountCents) : "—"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    disabled={rows.length <= 1}
                    onClick={() =>
                      setRows((rs) => rs.filter((r) => r.key !== row.key))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {/*
                  **A SUB-ROW, NOT A NINTH COLUMN.** The grid's two class
                  strings are written out in full because Tailwind scans for
                  literals, so making the column conditional on having any
                  dimensions would mean FOUR of them — tax × tags. And the grid
                  already scrolls at `min-w-[700px]`; widening it is a cost paid
                  on every invoice by every tenant, including the ones with no
                  dimensions at all.

                  `DimensionTags` renders nothing when there is nothing to pick,
                  so a business without dimensions sees exactly what it sees
                  today. Same placement as bank categorisation, under the field
                  it qualifies rather than beside it.
                */}
                {dimensionTypes.length > 0 && (
                  <div className="pl-1">
                    <DimensionTags
                      types={dimensionTypes}
                      value={row.dimensionMemberIds}
                      onValue={(v) =>
                        setRow(row.key, { dimensionMemberIds: v })
                      }
                      triggerClassName="h-7 px-2 text-xs font-normal text-muted-foreground"
                    />
                  </div>
                )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((rs) => [...rs, emptyRow(defaultAccount, showTax)])
            }
          >
            <Plus className="mr-1.5 size-4" /> Add line
          </Button>

          {products.length > 0 && (
            <Select
              value=""
              onValueChange={(id) => {
                const product = products.find((p) => p.id === id);
                if (!product) return;
                // Appends a line rather than replacing one: picking a saved
                // item is "add this to the invoice", not "change that row".
                setRows((rs) => [
                  ...rs,
                  {
                    key: crypto.randomUUID(),
                    description: product.description || product.name,
                    quantity: "1",
                    unitPrice: (Math.abs(product.unitPriceCents) / 100).toFixed(2),
                    discount: product.unitPriceCents < 0,
                    // A saved item carries no taxability of its own — that is
                    // a per-invoice question (who you sold to, where), not a
                    // property of the thing. It follows the invoice's rate.
                    taxable: showTax,
                    incomeAccountId: product.incomeAccountId ?? defaultAccount,
                    // A saved item carries no dimension of its own, for the same
                    // reason it carries no taxability: which part of the
                    // business earned this is a per-invoice fact, not a property
                    // of the thing sold.
                    dimensionMemberIds: [],
                  },
                ]);
              }}
            >
              <SelectTrigger className="w-56" aria-label="Add a saved item">
                <SelectValue placeholder="Add a saved item…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 border-t pt-4">
          <div className="space-y-0.5">
            {/* Subtotal and tax only appear once there is tax to show — on an
                untaxed invoice they are two extra rows that say nothing. */}
            {chosenRate && (
              <>
                <p className="flex justify-between gap-6 font-mono text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatCentsSigned(totals.subtotalCents)}</span>
                </p>
                <p className="flex justify-between gap-6 font-mono text-sm text-muted-foreground">
                  <span>
                    {chosenRate.name} ({formatRatePpm(chosenRate.ratePpm)}%)
                  </span>
                  <span>{formatCentsSigned(totals.taxCents)}</span>
                </p>
              </>
            )}
            <p className="flex justify-between gap-6 font-mono text-lg font-semibold">
              <span>Total</span>
              <span>{formatCentsSigned(totals.totalCents)}</span>
            </p>
          </div>
          <Button
            onClick={submit}
            disabled={pending || !customerId || !allValid || !issueDate}
          >
            {pending ? "Saving…" : invoice ? "Save changes" : "Save draft"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
