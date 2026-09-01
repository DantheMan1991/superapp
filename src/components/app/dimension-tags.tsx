"use client";

import { useState } from "react";
import { Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Radix `Select` cannot hold `""` as a value, so "none" needs a token. */
export const NO_MEMBER = "__none__";

export interface DimensionMemberOption {
  id: string;
  name: string;
}

export interface DimensionTypeOption {
  /** The stored slug — `enterprise`, `lot`, `asset`. */
  type: string;
  /** What to call it on screen. The caller resolves this; core has no list. */
  label: string;
  /** Active members only. See the note on archived ones below. */
  members: DimensionMemberOption[];
}

/**
 * **WHICH PARTS OF THE BUSINESS A JOURNAL LINE BELONGS TO.**
 *
 * ── WHY THIS IS GENERIC AND NOT AN ENTERPRISE PICKER ─────────────────────────
 *
 * `accounting` must not learn the word "enterprise". `core/dimensions.ts` states
 * the rule it is protecting — *"industry packs sync their entities into
 * dimension_members… the core never imports pack tables"* — and the P&L already
 * honours it: `pnl/page.tsx` derives its "Split by" options from
 * `[...new Set(members.map((m) => m.dimensionType))]` and hands core a plain
 * `string[]`. **This is the write end of that exact arrangement.** A control
 * called `EnterprisePicker` on a bill line would put a farm noun inside the
 * ledger, which is the mistake the settings screen shipped and had to fix.
 *
 * So the caller supplies the types, their words and their members, and nothing
 * here knows what any of them mean. A tenant with parcels and no enterprises
 * gets a parcel picker from the same component.
 *
 * ── WHY A POPOVER RATHER THAN N SELECTS IN A ROW ─────────────────────────────
 *
 * **The surfaces that need this are the narrow ones.** Bank categorisation is an
 * `h-8` select inside a table cell and a bill line is a five-column grid at
 * `min-w-[640px]` — neither has room for one dropdown per dimension type, and a
 * farm with batches, paddocks, equipment and lines of business has five. One
 * trigger that opens the lot of them fits where five never could, and it is the
 * same control on a wide form so nobody has to learn two.
 *
 * **The trigger says what is chosen**, because a tag nobody can see is a tag
 * nobody checks — and this is the field whose whole job is being correct later.
 *
 * ── TWO THINGS THE CALLER MUST GET RIGHT ─────────────────────────────────────
 *
 * **ACTIVE MEMBERS ONLY.** `listDimensionMembers` does NOT filter by
 * `is_active`, and `postEntry` refuses an inactive member outright with
 * `DIMENSION_INVALID` — so feeding this an unfiltered list offers a retired line
 * of business that then fails the whole save. The same trap cost the enterprise
 * posting path a bug; see `enterpriseMemberIds`.
 *
 * **ONE MEMBER PER TYPE IS THE LEDGER'S RULE, not this component's.**
 * `loadDimensionMembers` enforces it server-side and the database has a unique
 * index behind that. Modelling each type as its own single-select makes the
 * invalid state unrepresentable here rather than merely rejected later.
 */
export function DimensionTags({
  types,
  value,
  onValue,
  layout = "popover",
  triggerClassName,
}: {
  types: DimensionTypeOption[];
  /** The chosen member ids, in no particular order. */
  value: string[];
  onValue: (value: string[]) => void;
  /**
   * **`inline` FOR A FORM WITH ROOM, `popover` FOR A TABLE CELL.** Same
   * selects either way — only the wrapper differs, so the two surfaces cannot
   * drift into behaving differently. A popover inside a dialog also fights
   * Radix's focus handling for no gain when the dialog has the space.
   */
  layout?: "popover" | "inline";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  /**
   * **RENDERS NOTHING WHEN THERE IS NOTHING TO PICK**, which is most tenants on
   * most days. A business that has never created a dimension should not carry a
   * button that opens an empty popover on every row of every form — the rule
   * `EnterprisePicker` already follows.
   */
  const usable = types.filter((t) => t.members.length > 0);
  if (usable.length === 0) return null;

  const chosen = new Map<string, DimensionMemberOption>();
  for (const t of usable) {
    for (const m of t.members) {
      if (value.includes(m.id)) chosen.set(t.type, m);
    }
  }

  /**
   * Replacing one type's member leaves every OTHER type's alone. Rebuilding the
   * whole array from the map is what keeps that true without the caller having
   * to know which id belonged to which type.
   */
  function pick(type: string, memberId: string) {
    const next = new Map(chosen);
    if (memberId === NO_MEMBER) next.delete(type);
    else {
      const member = usable
        .find((t) => t.type === type)
        ?.members.find((m) => m.id === memberId);
      if (member) next.set(type, member);
    }
    onValue([...next.values()].map((m) => m.id));
  }

  const summary = [...chosen.values()].map((m) => m.name).join(", ");

  const fields = (
    <>
      {usable.map((t) => (
        <div key={t.type} className="grid gap-1.5">
          <Label
            htmlFor={`dim-${t.type}`}
            className="text-xs text-muted-foreground"
          >
            {t.label}
          </Label>
          <Select
            value={chosen.get(t.type)?.id ?? NO_MEMBER}
            onValueChange={(v) => pick(t.type, v)}
          >
            <SelectTrigger id={`dim-${t.type}`} className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* FIRST, for the reason `EnterprisePicker` gives: belonging to
                  none is the ordinary answer for most of what a business
                  spends money on. */}
              <SelectItem value={NO_MEMBER}>None</SelectItem>
              {t.members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </>
  );

  if (layout === "inline") {
    return <div className="grid gap-3">{fields}</div>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={triggerClassName}
        >
          <Tag className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{summary || "Tag"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-64 gap-3">
        {fields}
      </PopoverContent>
    </Popover>
  );
}
