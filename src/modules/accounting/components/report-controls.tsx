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
