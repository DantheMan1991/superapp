"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Radix `Select` cannot hold `""` as a value, so "none" needs a token. */
export const NO_ENTERPRISE = "__none__";

export interface EnterpriseOption {
  id: string;
  name: string;
}

/**
 * Which line of business something belongs to.
 *
 * **ONE COMPONENT FOR FOUR PACKS**, at `src/components/app/` for the reason the
 * table is at Layer 0: `inventory`, `livestock`, `production` and `retail` all
 * ask this question and none of them owns it. Four copies of a picker is four
 * places to forget that "none" is a real answer.
 *
 * **THE WORD IS PASSED IN, NEVER HARD-CODED.** A core control that said
 * "Enterprise" would be the same mistake the settings screen shipped and had to
 * fix — the caller resolves it from the profile and hands it down.
 *
 * **IT RENDERS NOTHING WHEN THERE IS NOTHING TO PICK.** A business that has not
 * set up a list should not be shown an empty dropdown on every form; the field
 * simply is not there until the list exists.
 */
export function EnterprisePicker({
  id,
  word,
  options,
  value,
  onValue,
  hint,
}: {
  id: string;
  /** What the installed profile calls one. */
  word: string;
  /** Active ones only — a retired line of business is not offered on new records. */
  options: EnterpriseOption[];
  /** An enterprise id, or `NO_ENTERPRISE`. */
  value: string;
  onValue: (value: string) => void;
  /** Optional sentence under the field, for a form where the default is not obvious. */
  hint?: string;
}) {
  if (options.length === 0) return null;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{word}</Label>
      <Select value={value} onValueChange={onValue}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/**
           * **FIRST, AND NOT LAST.** Belonging to none is the ordinary answer
           * for most of what a business holds — the tractor, the office paper,
           * the accountant — and burying it under the list would make the
           * common case the one that takes the most reading.
           */}
          <SelectItem value={NO_ENTERPRISE}>None</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** `NO_ENTERPRISE` → null, for the wire. */
export function enterpriseValue(value: string): string | null {
  return value === NO_ENTERPRISE ? null : value;
}

/** null → `NO_ENTERPRISE`, for the control. */
export function enterpriseSelection(id: string | null | undefined): string {
  return id ?? NO_ENTERPRISE;
}
