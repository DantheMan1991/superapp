"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, MapIcon, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/app/empty-state";
import { deleteFeaturesAction } from "../actions";
import { StatusBadge, type PanelFeature } from "./feature-panel";
import { featureKindLabel } from "../core/features";
import { asFeatureGeometry, geometryLengthM, shapeOf } from "../core/geo";
import {
  formatLength,
  formatLengthTotal,
  totalLength,
  type LengthUnit,
} from "../core/length";

/**
 * What is on the plan, as a list you can actually work.
 *
 * **WHY IT IS ITS OWN FILE NOW** (founder, 2026-08-30): *"this list could grow
 * where there are 100s of items. sort, bulk select and delete and filter."* He
 * is right, and it is not a hypothetical — a single `layoutPaddocks` run on a
 * twelve-paddock field emits a fence and a gate per paddock plus the lane
 * fences, so one decision can put thirty rows here. Before this the only way to
 * remove any of them was to click each one, open its panel, and delete it.
 *
 * Three controls, and the ordering of them is the order somebody reaches for
 * them: narrow it down (filter), find the one you want (sort), act on several
 * at once (select).
 */

/** What the sort is on. Matches the four columns, because those are the facts. */
type SortKey = "name" | "kind" | "status" | "length";

/**
 * The states worth filtering to, and the DEFAULT is not "everything".
 *
 * A pulled fence is history: it belongs in the list, behind a deliberate ask.
 * That was already true — this replaces a `Show N removed` toggle rather than
 * adding a control beside it, because two things governing which rows appear is
 * one thing too many.
 */
const STATE_FILTERS = {
  current: { label: "Built and proposed", match: (s: string) => s !== "removed" },
  built: { label: "Built", match: (s: string) => s === "built" },
  planned: { label: "Proposed", match: (s: string) => s === "planned" },
  removed: { label: "Removed", match: (s: string) => s === "removed" },
  all: { label: "Every state", match: () => true },
} as const;

type StateFilter = keyof typeof STATE_FILTERS;

const EVERY_KIND = "__every_kind__";

export function FeatureList({
  features,
  lengthUnit,
  canEdit,
  selectedId,
  onSelect,
}: {
  features: PanelFeature[];
  lengthUnit: LengthUnit;
  canEdit: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kindFilter, setKindFilter] = useState<string>(EVERY_KIND);
  const [stateFilter, setStateFilter] = useState<StateFilter>("current");
  const [sortKey, setSortKey] = useState<SortKey>("kind");
  const [ascending, setAscending] = useState(true);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  /** Only the kinds actually present. An empty option is a dead end. */
  const kinds = useMemo(() => {
    const present = new Set(features.map((feature) => feature.kind));
    return [...present]
      .map((kind) => ({ kind, label: featureKindLabel(kind) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [features]);

  /**
   * Length per feature, by id.
   *
   * **A POINT IS `null` FOR A DIFFERENT REASON FROM AN UNDRAWN FENCE**, and the
   * distinction survives into the total: both render as an em dash, but a gate
   * HAS no length while an untraced fence is MISSING one. `totalLength` reports
   * the second as an unknown, and four gates dropped exactly where they belong
   * were once announced as four things nobody had drawn yet.
   */
  const lengths = useMemo(() => {
    const map = new Map<string, { metres: number | null; isPoint: boolean }>();
    for (const feature of features) {
      const geometry = asFeatureGeometry(feature.geometry);
      if (!geometry) {
        map.set(feature.id, { metres: null, isPoint: false });
        continue;
      }
      const isPoint = shapeOf(geometry) === "point";
      map.set(feature.id, {
        metres: isPoint ? null : geometryLengthM(geometry),
        isPoint,
      });
    }
    return map;
  }, [features]);

  /**
   * The kind filter that is actually in force.
   *
   * **DELETING THE LAST WATERLINE MUST NOT LEAVE YOU FILTERED TO WATERLINES.**
   * The options are derived from what is present, so the chosen kind can stop
   * existing under you — and then the list is empty, the count reads "0 of 15",
   * and the only clue is a filter naming something that is gone. Derived rather
   * than reset in an effect: state that corrects itself after a render is state
   * that was briefly wrong.
   */
  const effectiveKind =
    kindFilter !== EVERY_KIND && kinds.some((k) => k.kind === kindFilter)
      ? kindFilter
      : EVERY_KIND;

  const listed = useMemo(() => {
    const matchesState = STATE_FILTERS[stateFilter].match;
    const rows = features.filter(
      (feature) =>
        matchesState(feature.status) &&
        (effectiveKind === EVERY_KIND || feature.kind === effectiveKind),
    );

    const direction = ascending ? 1 : -1;
    /** What a row is called in the list — the fallback is what the cell shows. */
    const nameOf = (feature: PanelFeature) =>
      feature.name || featureKindLabel(feature.kind);

    return rows.sort((a, b) => {
      if (sortKey === "length") {
        /**
         * **UNMEASURED ROWS SINK IN BOTH DIRECTIONS.** Sorting by length is
         * asking "what is longest" or "what is shortest"; a gate and an
         * untraced fence answer neither, and floating them to the top on the
         * descending pass would bury the answer under them.
         */
        const left = lengths.get(a.id)?.metres ?? null;
        const right = lengths.get(b.id)?.metres ?? null;
        if (left === null && right === null) return nameOf(a).localeCompare(nameOf(b));
        if (left === null) return 1;
        if (right === null) return -1;
        const order = left - right;
        return order === 0
          ? nameOf(a).localeCompare(nameOf(b))
          : order * direction;
      }

      const key = (feature: PanelFeature) =>
        sortKey === "name"
          ? nameOf(feature)
          : sortKey === "kind"
            ? featureKindLabel(feature.kind)
            : feature.status;
      const order = key(a).localeCompare(key(b));
      if (order !== 0) return order * direction;

      /**
       * **THE TIEBREAK IS THE NAME, NOT THE ID.** Sorting by kind put eight
       * fences in insertion order, which reads as no order at all — the server
       * had been ordering kind-then-name and the first version of this threw
       * that away. The tiebreak does NOT flip with the direction: reversing
       * "by kind" should reverse the kinds, not scramble the rows inside each.
       */
      return sortKey === "name"
        ? featureKindLabel(a.kind).localeCompare(featureKindLabel(b.kind))
        : nameOf(a).localeCompare(nameOf(b));
    });
  }, [ascending, effectiveKind, features, lengths, sortKey, stateFilter]);

  /**
   * What "Delete 5" would actually delete.
   *
   * **NARROWED TO WHAT IS ON SCREEN, ALWAYS.** Tick four rows, change the
   * filter, and the ticks for rows that scrolled out of existence must not
   * still count — a delete button whose number includes things you can no
   * longer see is how somebody removes a fence they never looked at.
   */
  const selected = useMemo(
    () => listed.filter((feature) => checked.has(feature.id)),
    [checked, listed],
  );

  const measurable = listed
    .filter((feature) => !lengths.get(feature.id)?.isPoint)
    .map((feature) => lengths.get(feature.id)?.metres ?? null);

  const removedCount = features.filter((f) => f.status === "removed").length;

  function toggle(id: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  function toggleAll() {
    setChecked((current) => {
      const allOn = listed.every((feature) => current.has(feature.id));
      const next = new Set(current);
      for (const feature of listed) {
        if (allOn) next.delete(feature.id);
        else next.add(feature.id);
      }
      return next;
    });
    setConfirming(false);
  }

  function sortOn(key: SortKey) {
    if (key === sortKey) {
      setAscending((up) => !up);
      return;
    }
    setSortKey(key);
    setAscending(true);
  }

  function remove() {
    const ids = selected.map((feature) => feature.id);
    startTransition(async () => {
      const result = await deleteFeaturesAction({ ids });
      setConfirming(false);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setChecked(new Set());
      onSelect(null);
      toast.success(`${ids.length} deleted`);
      router.refresh();
    });
  }

  if (features.length === 0) {
    return (
      <EmptyState
        icon={<MapIcon className="h-5 w-5" />}
        title="Nothing on the plan yet"
        description="Pick what you are adding, then trace it off the aerial. Switch to Site plan to see it as a drawing."
      />
    );
  }

  const allShown =
    listed.length > 0 && listed.every((feature) => checked.has(feature.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={effectiveKind} onValueChange={setKindFilter}>
          <SelectTrigger className="h-8 w-auto min-w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EVERY_KIND}>Every kind</SelectItem>
            {kinds.map((kind) => (
              <SelectItem key={kind.kind} value={kind.kind}>
                {kind.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={stateFilter}
          onValueChange={(value) => setStateFilter(value as StateFilter)}
        >
          <SelectTrigger className="h-8 w-auto min-w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATE_FILTERS) as StateFilter[]).map((key) => (
              <SelectItem key={key} value={key}>
                {STATE_FILTERS[key].label}
                {key === "removed" && removedCount > 0 ? ` (${removedCount})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          {listed.length === features.length
            ? `${features.length} shown`
            : `${listed.length} of ${features.length}`}
        </span>

        {canEdit && selected.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            className={`ml-auto ${confirming ? "text-destructive" : "text-muted-foreground"}`}
            onClick={() => (confirming ? remove() : setConfirming(true))}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {confirming
              ? `Delete ${selected.length}? This cannot be undone`
              : `Delete ${selected.length}`}
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {canEdit && (
              <TableHead className="w-8">
                <Checkbox
                  checked={allShown}
                  onCheckedChange={toggleAll}
                  aria-label="Select everything shown"
                  disabled={listed.length === 0}
                />
              </TableHead>
            )}
            <SortHeader
              label="What"
              onClick={() => sortOn("name")}
              active={sortKey === "name"}
              ascending={ascending}
            />
            <SortHeader
              label="Kind"
              onClick={() => sortOn("kind")}
              active={sortKey === "kind"}
              ascending={ascending}
            />
            <SortHeader
              label="State"
              onClick={() => sortOn("status")}
              active={sortKey === "status"}
              ascending={ascending}
            />
            <SortHeader
              label="Length"
              onClick={() => sortOn("length")}
              active={sortKey === "length"}
              ascending={ascending}
              alignRight
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {listed.map((feature) => (
            <TableRow
              key={feature.id}
              onClick={() =>
                onSelect(feature.id === selectedId ? null : feature.id)
              }
              className={`cursor-pointer ${feature.id === selectedId ? "bg-muted" : ""}`}
            >
              {canEdit && (
                <TableCell
                  // The tick is not the row: ticking four things to delete them
                  // should not also open the fourth one's panel underneath.
                  onClick={(event) => event.stopPropagation()}
                >
                  <Checkbox
                    checked={checked.has(feature.id)}
                    onCheckedChange={() => toggle(feature.id)}
                    aria-label={`Select ${feature.name || featureKindLabel(feature.kind)}`}
                  />
                </TableCell>
              )}
              <TableCell className="font-medium">
                {feature.name || (
                  <span className="text-muted-foreground">
                    {featureKindLabel(feature.kind)}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {featureKindLabel(feature.kind)}
              </TableCell>
              <TableCell>
                <StatusBadge status={feature.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatLength(lengths.get(feature.id)?.metres ?? null, lengthUnit)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {listed.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nothing matches that. Widen the filters above.
        </p>
      )}

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        {/* A total that let an undrawn feature read as zero would be
            confidently wrong — `totalLength` reports the unknowns instead. */}
        <span>{formatLengthTotal(totalLength(measurable), lengthUnit)} in all</span>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  onClick,
  active,
  ascending,
  alignRight = false,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  ascending: boolean;
  alignRight?: boolean;
}) {
  const Arrow = ascending ? ArrowUp : ArrowDown;
  return (
    <TableHead className={alignRight ? "text-right" : undefined}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
          active ? "text-foreground" : ""
        }`}
      >
        {label}
        {active && <Arrow className="h-3 w-3" />}
      </button>
    </TableHead>
  );
}
