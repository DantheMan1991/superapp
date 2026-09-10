"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  MapIcon,
  Trash2,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
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
  compareNames,
  groupRows,
  matchesTerm,
  NO_PLAN,
  type GroupBy,
} from "../core/list";
import {
  formatLength,
  formatLengthTotal,
  totalLength,
  type LengthUnit,
} from "../core/length";

/**
 * What is on the plan, as a list you can actually work.
 *
 * **WHY IT IS ITS OWN FILE** (founder, 2026-08-30): *"this list could grow
 * where there are 100s of items. sort, bulk select and delete and filter."* He
 * is right, and it is not a hypothetical — a single `layoutPaddocks` run on a
 * twelve-paddock field emits a fence and a gate per paddock plus the lane
 * fences, so one decision can put thirty rows here.
 *
 * **AND THAT IS WHY IT GROUPS** (founder, 2026-09-10): *"it would be nicer if
 * things collapsed under a category you could open — all the paddocks' fences
 * under a paddocks heading, say, rather than thirty rows in a row."* Two
 * groupings, and both are free:
 *
 *   - **by KIND** — every row has one, so it is meaningful on a parcel nobody
 *     has ever laid out.
 *   - **by PLAN** — `land_features.plan_id` has existed since 2b.4 and
 *     `layoutPaddocks` stamps every feature it emits, so the thirty rows from
 *     one decision already share a key AND the name the person typed.
 *
 * **There is no `by paddock`, and the reason is not the migration** — see
 * `core/list.ts`: a dividing fence bounds two paddocks, so it is not a
 * function.
 *
 * Four controls now, in the order somebody reaches for them: break it up
 * (group), narrow it down (filter, find), order it (sort), act on several at
 * once (select).
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

const GROUP_LABELS: Record<GroupBy, string> = {
  kind: "Group by kind",
  plan: "Group by plan",
  none: "No grouping",
};

export function FeatureList({
  features,
  plans,
  lengthUnit,
  canEdit,
  selectedId,
  onSelect,
}: {
  features: PanelFeature[];
  /** Named sets of proposals, for the `plan` grouping's headings. */
  plans: { id: string; name: string }[];
  lengthUnit: LengthUnit;
  canEdit: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kindFilter, setKindFilter] = useState<string>(EVERY_KIND);
  const [stateFilter, setStateFilter] = useState<StateFilter>("current");
  const [groupBy, setGroupBy] = useState<GroupBy>("kind");
  const [term, setTerm] = useState("");
  /**
   * Which headings the person has opened.
   *
   * **OPENED RATHER THAN CLOSED, because closed is the useful default.** With
   * grouping on, a heading carrying `Fences (8) · 7,700 ft` answers more at a
   * glance than eight rows do — and an open-by-default list of five headings
   * and fifteen rows is longer than the flat list it replaced, which would
   * defeat the whole point.
   */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("kind");
  const [ascending, setAscending] = useState(true);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  /** Only the kinds actually present. An empty option is a dead end. */
  const kinds = useMemo(() => {
    const present = new Set(features.map((feature) => feature.kind));
    return [...present]
      .map((kind) => ({ kind, label: featureKindLabel(kind) }))
      .sort((a, b) => compareNames(a.label, b.label));
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
        (effectiveKind === EVERY_KIND || feature.kind === effectiveKind) &&
        matchesTerm(term, feature.name, featureKindLabel(feature.kind)),
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
        if (left === null && right === null) return compareNames(nameOf(a), nameOf(b));
        if (left === null) return 1;
        if (right === null) return -1;
        const order = left - right;
        return order === 0
          ? compareNames(nameOf(a), nameOf(b))
          : order * direction;
      }

      const key = (feature: PanelFeature) =>
        sortKey === "name"
          ? nameOf(feature)
          : sortKey === "kind"
            ? featureKindLabel(feature.kind)
            : feature.status;
      const order = compareNames(key(a), key(b));
      if (order !== 0) return order * direction;

      /**
       * **THE TIEBREAK IS THE NAME, NOT THE ID.** Sorting by kind put eight
       * fences in insertion order, which reads as no order at all — the server
       * had been ordering kind-then-name and the first version of this threw
       * that away. The tiebreak does NOT flip with the direction: reversing
       * "by kind" should reverse the kinds, not scramble the rows inside each.
       */
      return sortKey === "name"
        ? compareNames(featureKindLabel(a.kind), featureKindLabel(b.kind))
        : compareNames(nameOf(a), nameOf(b));
    });
  }, [ascending, effectiveKind, features, lengths, sortKey, stateFilter, term]);

  const planNames = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan.name])),
    [plans],
  );

  const groups = useMemo(
    () =>
      groupRows(listed, groupBy, (key) => {
        if (groupBy === "kind") return featureKindLabel(key);
        if (key === NO_PLAN) return "Not in a plan";
        // A plan that has been removed leaves its features behind, pointing at
        // nothing. Say so rather than rendering an empty heading.
        return planNames.get(key) ?? "A plan that is gone";
      }),
    [groupBy, listed, planNames],
  );

  /**
   * Is this heading open?
   *
   * A search opens everything that matched — otherwise typing a fence's name
   * would leave you looking at a closed heading, which is the opposite of
   * finding it. One group is open because there is nothing to choose between.
   */
  const searching = term.trim().length > 0;
  const openKeys = useMemo(() => {
    const everything =
      groupBy === "none" || searching || groups.length === 1;
    return new Set(everything ? groups.map((group) => group.key) : opened);
  }, [groupBy, groups, opened, searching]);
  const isOpen = (key: string) => openKeys.has(key);

  function toggleGroup(key: string) {
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * The rows somebody can actually see: listed, and under an open heading.
   *
   * **THIS IS WHAT SELECTION IS NARROWED TO**, extending the rule that was
   * already here for the filters. A delete button whose number includes rows
   * hidden inside a closed heading is the same failure as one counting rows a
   * filter removed — you delete a fence you never looked at. The ticks
   * themselves survive in `checked`, so closing and reopening a heading brings
   * them back.
   */
  const visible = useMemo(
    () =>
      groups
        .filter((group) => openKeys.has(group.key))
        .flatMap((group) => group.rows),
    [groups, openKeys],
  );

  const selected = useMemo(
    () => visible.filter((feature) => checked.has(feature.id)),
    [checked, visible],
  );

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

  function toggleMany(rows: PanelFeature[]) {
    setChecked((current) => {
      const allOn = rows.length > 0 && rows.every((row) => current.has(row.id));
      const next = new Set(current);
      for (const row of rows) {
        if (allOn) next.delete(row.id);
        else next.add(row.id);
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
    visible.length > 0 && visible.every((feature) => checked.has(feature.id));
  const columns = canEdit ? 5 : 4;

  /** "8 · 7,700 ft", with the length dropped when nothing in it has one. */
  function groupSummary(rows: PanelFeature[]): string {
    const measurable = rows
      .filter((row) => !lengths.get(row.id)?.isPoint)
      .map((row) => lengths.get(row.id)?.metres ?? null);
    // Every row is a point — four gates have a count and no length, and
    // "0 ft" would be a length.
    if (measurable.length === 0) return `${rows.length}`;
    return `${rows.length} · ${formatLengthTotal(totalLength(measurable), lengthUnit)}`;
  }

  const measurable = listed
    .filter((feature) => !lengths.get(feature.id)?.isPoint)
    .map((feature) => lengths.get(feature.id)?.metres ?? null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={groupBy}
          onValueChange={(value) => setGroupBy(value as GroupBy)}
        >
          <SelectTrigger
            className="h-8 w-auto min-w-36 text-xs"
            aria-label="Grouping"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(GROUP_LABELS) as GroupBy[]).map((key) => (
              <SelectItem key={key} value={key}>
                {GROUP_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={effectiveKind} onValueChange={setKindFilter}>
          <SelectTrigger className="h-8 w-auto min-w-36 text-xs" aria-label="Kind">
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
          <SelectTrigger className="h-8 w-auto min-w-40 text-xs" aria-label="State">
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

        {/* Grouping hides rows behind headings, so this is what gets one back
            without opening every heading to look for it. Client-side over rows
            the page already has — there is no round trip to wait for. */}
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Find by name"
          aria-label="Find by name"
          className="h-8 w-full text-xs sm:w-44"
        />

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

      {/* Phone: headings and cards. The table put `Length` — the one number a
          fence has — at x=399 in a 375px screen, off the right edge. */}
      <ul className="space-y-3 md:hidden">
        {groups.map((group) => (
          <li key={group.key}>
            {groupBy !== "none" && (
              <GroupHeading
                label={group.label}
                summary={groupSummary(group.rows)}
                open={isOpen(group.key)}
                onToggle={() => toggleGroup(group.key)}
              />
            )}
            {isOpen(group.key) && (
              <ul className={groupBy === "none" ? "space-y-3" : "mt-2 space-y-3"}>
                {group.rows.map((feature) => (
                  <li key={feature.id} className="flex items-start gap-2">
                    {canEdit && (
                      <span className="pt-4">
                        <Checkbox
                          checked={checked.has(feature.id)}
                          onCheckedChange={() => toggle(feature.id)}
                          aria-label={`Select ${feature.name || featureKindLabel(feature.kind)}`}
                        />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        onSelect(feature.id === selectedId ? null : feature.id)
                      }
                      className={`min-w-0 flex-1 rounded-2xl p-4 text-left shadow-elevation-1 transition-shadow hover:shadow-elevation-3 ${
                        feature.id === selectedId ? "bg-muted" : "bg-card"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {feature.name || featureKindLabel(feature.kind)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {featureKindLabel(feature.kind)}
                          </p>
                        </div>
                        <p className="shrink-0 text-right tabular-nums">
                          {formatLength(
                            lengths.get(feature.id)?.metres ?? null,
                            lengthUnit,
                          )}
                        </p>
                      </div>
                      <div className="mt-2">
                        <StatusBadge status={feature.status} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {canEdit && (
                <TableHead className="w-8">
                  <Checkbox
                    checked={allShown}
                    onCheckedChange={() => toggleMany(visible)}
                    aria-label="Select everything shown"
                    disabled={visible.length === 0}
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
            {groups.map((group) => (
              <FeatureGroupRows
                key={group.key}
                group={group}
                columns={columns}
                open={isOpen(group.key)}
                showHeading={groupBy !== "none"}
                summary={groupSummary(group.rows)}
                onToggle={() => toggleGroup(group.key)}
                canEdit={canEdit}
                checked={checked}
                onCheck={toggle}
                onCheckGroup={() => toggleMany(group.rows)}
                selectedId={selectedId}
                onSelect={onSelect}
                lengths={lengths}
                lengthUnit={lengthUnit}
              />
            ))}
          </TableBody>
        </Table>
      </div>

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

/** One heading on the phone: what it is, how much of it, and open or closed. */
function GroupHeading({
  label,
  summary,
  open,
  onToggle,
}: {
  label: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left text-sm font-medium hover:bg-muted"
    >
      <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
        {summary}
      </span>
    </button>
  );
}

/**
 * One heading and its rows, in the table.
 *
 * A fragment rather than a component wrapping `<tbody>`: a heading is a row
 * spanning every column, and its rows are ordinary rows underneath, so the
 * table keeps one column layout throughout.
 */
function FeatureGroupRows({
  group,
  columns,
  open,
  showHeading,
  summary,
  onToggle,
  canEdit,
  checked,
  onCheck,
  onCheckGroup,
  selectedId,
  onSelect,
  lengths,
  lengthUnit,
}: {
  group: { key: string; label: string; rows: PanelFeature[] };
  columns: number;
  open: boolean;
  showHeading: boolean;
  summary: string;
  onToggle: () => void;
  canEdit: boolean;
  checked: ReadonlySet<string>;
  onCheck: (id: string) => void;
  onCheckGroup: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  lengths: Map<string, { metres: number | null; isPoint: boolean }>;
  lengthUnit: LengthUnit;
}) {
  const allOn =
    group.rows.length > 0 && group.rows.every((row) => checked.has(row.id));
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <>
      {showHeading && (
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          {canEdit && (
            <TableCell>
              {/* Only while the heading is open. Ticking a closed one would
                  select rows nobody has looked at, which is the rule the
                  filters already follow. */}
              {open && (
                <Checkbox
                  checked={allOn}
                  onCheckedChange={onCheckGroup}
                  aria-label={`Select everything under ${group.label}`}
                />
              )}
            </TableCell>
          )}
          <TableCell colSpan={columns - (canEdit ? 1 : 0)} className="p-0">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
            >
              <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{group.label}</span>
              <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                {summary}
              </span>
            </button>
          </TableCell>
        </TableRow>
      )}

      {open &&
        group.rows.map((feature) => (
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
                  onCheckedChange={() => onCheck(feature.id)}
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
    </>
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
