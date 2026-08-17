"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
  RANGE_PRESETS,
  presetRange,
  type RangePreset,
} from "../lib/dates";

/**
 * Report parameter form — plain GET submit back to the page (the
 * trial-balance convention). Presets are computed client-side from
 * `today` (tenant-timezone, server-supplied) + the FY start month.
 */
export function ReportControls({
  mode,
  today,
  fiscalYearStartMonth,
  from,
  to,
  asOf,
  compare,
  compareOptions,
  dim,
  dimensionTypes,
  basis,
  showBasis,
  account,
  accounts,
  spread,
  showSpread,
  entity,
  entities,
  offerConsolidated,
}: {
  mode: "range" | "asOf";
  today: string;
  fiscalYearStartMonth: number;
  from?: string;
  to?: string;
  asOf?: string;
  compare?: string;
  /** e.g. [["prev-period", "Previous period"], ["prev-year", "Previous year"]] */
  compareOptions?: Array<[value: string, label: string]>;
  dim?: string;
  dimensionTypes?: string[];
  /** Omit on reports that read the same on either basis (Cash Activity). */
  basis?: string;
  showBasis?: boolean;
  /** Currently selected account id, or "" for all. General Ledger only. */
  account?: string;
  /**
   * Narrow the report to one account. Passing the list turns the control on.
   *
   * On the General Ledger this is what makes "Transaction Detail by Account"
   * the same report rather than a second one — the two differ only by whether
   * an account is chosen.
   */
  accounts?: Array<{ id: string; code: string; name: string }>;
  /**
   * Column axis: "" for one total column, "month" for P&L by Month.
   *
   * Its OWN parameter rather than another value in `dim`, deliberately:
   * `dimension_members.dimension_type` is free text, not an enum, so a tenant
   * can legitimately have a dimension called "month" and a shared value space
   * would collide with it.
   */
  spread?: string;
  showSpread?: boolean;
  /** Currently scoped company id, or "" / undefined for all of them. */
  entity?: string;
  /**
   * The tenant's legal entities (ADR 0010). The control renders only when
   * there are TWO OR MORE — a client with one company must never learn the
   * concept exists, and a picker with a single option is furniture that
   * suggests a decision nobody has to make.
   *
   * It is a URL parameter rather than an ambient selection on purpose: a report
   * whose scope came from a control three screens away is a report whose reader
   * cannot tell whose books they are looking at, which is the failure ADR 0010
   * names as the worst possible signature. The chosen company is stamped in the
   * page footer and in every CSV, exactly as the basis is.
   */
  entities?: Array<{ id: string; name: string }>;
  /**
   * Offer "All companies (consolidated)" beside combined (ADR 0010 slice 3).
   *
   * Comes from `resolveReportEntity`, never decided here: the reports that
   * decline it do so for reasons about what they read, and a picker that
   * offered it on one of them would produce a 404 rather than a report.
   */
  offerConsolidated?: boolean;
}) {
  const [range, setRange] = useState({ from: from ?? today, to: to ?? today });
  const [preset, setPreset] = useState<RangePreset>("custom");

  function applyPreset(value: RangePreset) {
    setPreset(value);
    if (value !== "custom") {
      setRange(presetRange(value, today, fiscalYearStartMonth));
    }
  }

  return (
    <form method="get" className="flex flex-wrap items-end gap-3 print:hidden">
      {mode === "range" ? (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Preset</Label>
            <Select value={preset} onValueChange={(v) => applyPreset(v as RangePreset)}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="from" className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id="from"
              name="from"
              type="date"
              className="h-9"
              value={range.from}
              onChange={(e) => {
                setPreset("custom");
                setRange((r) => ({ ...r, from: e.target.value }));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id="to"
              name="to"
              type="date"
              className="h-9"
              value={range.to}
              onChange={(e) => {
                setPreset("custom");
                setRange((r) => ({ ...r, to: e.target.value }));
              }}
            />
          </div>
        </>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="asOf" className="text-xs text-muted-foreground">
            As of
          </Label>
          <Input
            id="asOf"
            name="asOf"
            type="date"
            className="h-9"
            defaultValue={asOf ?? today}
          />
        </div>
      )}

      {entities && entities.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="entity" className="text-xs text-muted-foreground">
            Company
          </Label>
          <select
            id="entity"
            name="entity"
            defaultValue={entity ?? ""}
            className="border-input h-9 w-52 rounded-md border bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="">All companies (combined)</option>
            {offerConsolidated && (
              <option value="consolidated">All companies (consolidated)</option>
            )}
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {showBasis && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Basis</Label>
          <select
            name="basis"
            defaultValue={basis === "cash" ? "cash" : "accrual"}
            className="border-input h-9 w-32 rounded-md border bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="accrual">Accrual</option>
            <option value="cash">Cash</option>
          </select>
        </div>
      )}

      {accounts && accounts.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="account" className="text-xs text-muted-foreground">
            Account
          </Label>
          <select
            id="account"
            name="account"
            defaultValue={account ?? ""}
            className="border-input h-9 w-64 rounded-md border bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {showSpread && (
        <div className="space-y-1.5">
          <Label htmlFor="spread" className="text-xs text-muted-foreground">
            Columns
          </Label>
          <select
            id="spread"
            name="spread"
            defaultValue={spread === "month" ? "month" : ""}
            className="border-input h-9 w-36 rounded-md border bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="">One total</option>
            <option value="month">By month</option>
          </select>
        </div>
      )}

      {compareOptions && compareOptions.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Compare</Label>
          <select
            name="compare"
            defaultValue={compare ?? ""}
            className="border-input h-9 w-40 rounded-md border bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="">No comparison</option>
            {compareOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      {dimensionTypes && dimensionTypes.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Split by</Label>
          <select
            name="dim"
            defaultValue={dim ?? ""}
            className="border-input h-9 w-40 rounded-md border bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="">No split</option>
            {dimensionTypes.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
      )}

      <Button type="submit" variant="outline" size="sm" className="h-9">
        Run
      </Button>
    </form>
  );
}
