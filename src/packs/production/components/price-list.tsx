"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  removePriceItemsAction,
  setPriceItemKindAction,
} from "../processor-actions";
import { describeBand, isBanded } from "../core/band";
import {
  PRICE_CATEGORY_LABELS,
  centsToDisplay,
  compareLabels,
  priceCategoryRank,
  priceWithUnit,
  slugLabel,
} from "../vocabulary";
import { PriceItemDialog, RemovePriceItemButton } from "./processor-controls";

/**
 * A PROCESSOR'S PRICE LIST, GROUPED BY ANIMAL AND THEN BY WHAT THE SHEET CALLS
 * IT.
 *
 * **A FLAT LIST STOPPED WORKING AT 108 ITEMS**, which is what one real rate
 * sheet produces. The founder's words on seeing it: *"a giant list of turkey
 * geese etc when all i need to look at is chicken if that is the batch."* So
 * the animal is the outer grouping and everything else hangs under it, closed
 * until asked for.
 *
 * **AND ONE ANIMAL WAS STILL A WALL.** Opening `chicken` on the same sheet gave
 * 45 rows in one run — a slaughter matrix, a cutting menu, packaging and giblets
 * with nothing between them. The sheet's own grouping is the second axis, the
 * same `category` the picker already groups by and in the same order the paper
 * uses: slaughter first, then the layers on top of it.
 *
 * **THE GROUPS ARE THE DATA, NOT A SETTING.** They are whatever animals this
 * plant actually has prices for, in the farm's own words, and a plant with one
 * animal gets one group. Nothing here decides what an animal is.
 *
 * **BULK EDITING IS NOT A CONVENIENCE HERE.** 108 rows arrived mis-filed
 * because the sheet says "Duck & Geese" and the reader could not map that to
 * one animal; fixing that one row at a time is not a thing anybody would do, so
 * the list would simply stay wrong. Select, then move or remove — and the tick
 * on a category heading is there because a mis-filed sheet is usually mis-filed
 * a whole category at a time.
 */

export interface PriceRow {
  id: string;
  kind: string;
  category: string;
  label: string;
  variant: string;
  headMin: number;
  headMax: number | null;
  priceCents: number | null;
  unit: string;
  minimumCents: number | null;
  notes: string;
}

const UNSORTED = " unsorted";

/** How a category reads. Falls back to the slug for anything unanticipated. */
function categoryLabel(category: string): string {
  return PRICE_CATEGORY_LABELS[category] ?? slugLabel(category);
}

export function PriceList({
  processorId,
  items,
  kindOptions,
  isOwner,
}: {
  processorId: string;
  items: PriceRow[];
  kindOptions: string[];
  isOwner: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState<string>(kindOptions[0] ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  /**
   * Animal first, then the way the paper groups itself, then the plant's own
   * words — read as a person reads them, so `50 to 100` comes before `101 to
   * 250` rather than after `1001 to 1500`. The unsorted group sorts LAST and is
   * named for what it is: a row nobody has said which animal it is for. It is
   * the pile you are meant to empty, so it must not hide at the top pretending
   * to be a category.
   */
  const groups = useMemo(() => {
    const byKind = new Map<string, PriceRow[]>();
    for (const item of items) {
      const key = item.kind === "" ? UNSORTED : item.kind;
      const list = byKind.get(key);
      if (list) list.push(item);
      else byKind.set(key, [item]);
    }

    return [...byKind.entries()]
      .sort(([a], [b]) => {
        if (a === UNSORTED) return 1;
        if (b === UNSORTED) return -1;
        return a.localeCompare(b);
      })
      .map(([key, rows]) => {
        const byCategory = new Map<string, PriceRow[]>();
        for (const item of rows) {
          const list = byCategory.get(item.category);
          if (list) list.push(item);
          else byCategory.set(item.category, [item]);
        }
        for (const list of byCategory.values()) {
          list.sort(
            (a, b) =>
              compareLabels(a.label, b.label) ||
              a.variant.localeCompare(b.variant) ||
              // The ladder in the order it is climbed. The whole reason the
              // band is a pair of numbers rather than words in the label.
              a.headMin - b.headMin,
          );
        }
        const categories = [...byCategory.entries()].sort(
          ([a], [b]) =>
            priceCategoryRank(a) - priceCategoryRank(b) || a.localeCompare(b),
        );
        return { key, rows, categories };
      });
  }, [items]);

  const toggleGroup = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleRow = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pickMany = (rows: PriceRow[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });

  const move = () => {
    const ids = [...picked];
    startTransition(async () => {
      const result = await setPriceItemKindAction({ ids, kind: moveTo });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      const moved = "moved" in result ? (result.moved as number) : 0;
      const clashed = "clashed" in result ? (result.clashed as string[]) : [];
      if (clashed.length > 0) {
        // NAMED, NOT COUNTED. "3 could not move" is not actionable; the labels
        // are, because the fix is to rename or remove the one already there.
        toast.warning(
          `${moved} moved. ${clashed.length} left alone — ${clashed
            .slice(0, 3)
            .join(", ")}${clashed.length > 3 ? "…" : ""} already priced under ${slugLabel(moveTo)}.`,
        );
      } else {
        toast.success(`${moved} moved to ${slugLabel(moveTo)}`);
      }
      setPicked(new Set());
      router.refresh();
    });
  };

  const removeMany = () => {
    const ids = [...picked];
    startTransition(async () => {
      const result = await removePriceItemsAction({ ids });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${"removed" in result ? result.removed : ids.length} removed`);
      setPicked(new Set());
      router.refresh();
    });
  };

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No prices on file. Photograph their rate sheet and it will read it —
        nothing is recorded until you have checked it.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/*
        THE BAR APPEARS ONLY WITH A SELECTION, so the ordinary reading case is
        not carrying a row of controls nobody asked for.
      */}
      {isOwner && picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
          <span className="text-sm font-medium">{picked.size} selected</span>
          <Select value={moveTo} onValueChange={setMoveTo}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Which animal" />
            </SelectTrigger>
            <SelectContent>
              {kindOptions.map((k) => (
                <SelectItem key={k} value={k}>
                  {slugLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={move} disabled={pending || !moveTo}>
            Move to this animal
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={removeMany}
            disabled={pending}
          >
            Remove these
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPicked(new Set())}
            disabled={pending}
          >
            Clear
          </Button>
        </div>
      )}

      {groups.map(({ key, rows, categories }) => {
        const isOpen = open.has(key);
        const allPicked = rows.every((r) => picked.has(r.id));
        return (
          <div key={key} className="rounded-md border">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              {/*
                A CHECKBOX, NOT A SWITCH. A switch turns a thing on: beside a
                heading reading "Cattle 2" it says *switch cattle on*, which is
                not what ticking a row to move it means. The kit had no tick box
                until this slice; `Switch` stays where it genuinely toggles a
                behaviour, like Replace on the read dialog.
              */}
              {isOwner && (
                <Checkbox
                  checked={allPicked}
                  onCheckedChange={(v) => pickMany(rows, v === true)}
                  aria-label={`Select every price for ${
                    key === UNSORTED ? "the unsorted rows" : slugLabel(key)
                  }`}
                />
              )}
              <button
                type="button"
                className="flex flex-1 items-center gap-2 text-left"
                onClick={() => toggleGroup(key)}
              >
                <span className="font-medium">
                  {key === UNSORTED ? "Not said which animal" : slugLabel(key)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {rows.length}
                </span>
                {key === UNSORTED && (
                  <Badge variant="outline">Needs sorting</Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {isOpen ? "Hide" : "Show"}
                </span>
              </button>
            </div>

            {isOpen && (
              <div className="border-t">
                {categories.map(([category, categoryRows]) => {
                  const label = categoryLabel(category);
                  const allOfCategory = categoryRows.every((r) =>
                    picked.has(r.id),
                  );
                  return (
                    <div key={category}>
                      {/*
                        THE SECOND AXIS. 45 chicken rows in one run is a wall,
                        and the sheet itself is not written that way — it puts
                        the slaughter fee at the top and the choices under it.
                      */}
                      <div className="flex items-center gap-2 bg-muted/30 px-3 py-1">
                        {isOwner && (
                          <Checkbox
                            checked={allOfCategory}
                            onCheckedChange={(v) =>
                              pickMany(categoryRows, v === true)
                            }
                            aria-label={`Select every ${label} price for ${
                              key === UNSORTED
                                ? "the unsorted rows"
                                : slugLabel(key)
                            }`}
                          />
                        )}
                        <span className="text-xs font-medium text-muted-foreground">
                          {label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {categoryRows.length}
                        </span>
                      </div>
                      <ul className="text-sm">
                        {categoryRows.map((item) => {
                          const money = priceWithUnit(item.priceCents, item.unit);
                          return (
                            <li
                              key={item.id}
                              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5"
                            >
                              {isOwner && (
                                <Checkbox
                                  checked={picked.has(item.id)}
                                  onCheckedChange={() => toggleRow(item.id)}
                                  aria-label={`Select ${item.label}`}
                                />
                              )}
                              <span>{item.label}</span>
                              {/*
                                **WHAT TELLS 24 SIBLINGS APART, IN ITS OWN
                                COLUMN.** Until 2f this was inside the label, so
                                the app could not read it and the list could not
                                sort it: `1001 to 1500` came before `101 to 250`
                                because both were text.
                              */}
                              {item.variant !== "" && (
                                <span className="text-foreground/80">
                                  {item.variant}
                                </span>
                              )}
                              {isBanded(item) && (
                                <span className="text-muted-foreground tabular-nums">
                                  {describeBand(item)}
                                </span>
                              )}
                              {/*
                                **NO CATEGORY ON THE ROW AT ALL, AND THAT IS
                                THIS SLICE'S OWN DEFECT CAUGHT BY DRIVING.**
                                2e suppressed it when it exactly repeated the
                                label; 2f went further and put a *Cutting 10*
                                heading above the rows — at which point every
                                one of the ten saying "Cutting" is the same
                                doubling one level up. The heading is the
                                category now. `categoryRepeatsLabel` still earns
                                its place on the cut sheet, which has no
                                headings to group under.
                              */}
                              <span
                                className={
                                  money
                                    ? "ml-auto font-medium"
                                    : "ml-auto text-muted-foreground"
                                }
                              >
                                {money ?? "Not quoted"}
                              </span>
                              {item.minimumCents !== null && (
                                <span className="text-muted-foreground">
                                  {centsToDisplay(item.minimumCents)} minimum
                                </span>
                              )}
                              {item.notes !== "" && (
                                <span className="text-muted-foreground">
                                  {item.notes}
                                </span>
                              )}
                              {isOwner && (
                                <span className="flex items-center">
                                  <PriceItemDialog
                                    processorId={processorId}
                                    kindOptions={kindOptions}
                                    existing={item}
                                  />
                                  <RemovePriceItemButton id={item.id} />
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
