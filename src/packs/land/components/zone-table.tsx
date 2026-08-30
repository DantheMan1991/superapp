"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArrowDown, ArrowUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { retireZonesAction } from "../actions";
import { ZoneControls } from "./zone-controls";
import { formatArea, fromAcres, type AreaUnit } from "../core/area";
import { formatDays } from "../core/rest";
import { zoneUseLabel } from "../vocabulary";

/**
 * The paddocks on a parcel, as a list you can actually work.
 *
 * **THE SAME TREATMENT THE PLAN LIST GOT IN 2b.6**, asked for in one line the
 * day after: *"do the same for the paddock table"*. It matters at the same
 * scale and for the same reason — a farm at 10x has two hundred paddocks and
 * this was an unsorted, unfiltered list with a per-row menu.
 *
 * **BUT THE BULK ACT IS RETIRE, NOT DELETE, AND THAT ASYMMETRY IS THE POINT.**
 * A fence you pull out is gone. A paddock you stop managing had cattle on it,
 * has a use history and has costs tagged to it, and every one of those
 * questions still has an answer that a delete would erase. Deleting is
 * `discardZones`, and it only ever touches ground nobody fenced — which is why
 * it lives on the Proposed panel above this table and not in it.
 */

/** What the sort is on. The four columns, because those are the facts shown. */
type SortKey = "name" | "use" | "rest" | "area";

const EVERY_USE = "__every_use__";
const NO_USE = "__no_use__";

/**
 * The statuses worth filtering to, and the DEFAULT is not "everything".
 *
 * A retired paddock is history. It belongs in the list behind a deliberate ask,
 * the same rule the plan list follows for a pulled fence — and until this slice
 * it was not in the list at all, because the page never read retired rows.
 */
const STATUS_FILTERS = {
  active: { label: "In use", match: (s: string) => s === "active" },
  retired: { label: "Retired", match: (s: string) => s === "retired" },
  all: { label: "In use and retired", match: () => true },
} as const;

type StatusFilter = keyof typeof STATUS_FILTERS;

export interface ZoneRow {
  id: string;
  name: string;
  status: string;
  areaAcres: number | null;
  notes: string;
  /** What it is for now, or null. */
  use: {
    use: string;
    isProductive: boolean;
    startedOn: string;
  } | null;
  /** Rest, computed from occupancy on the server. Never stored. */
  rest: {
    status: string;
    restDays: number | null;
  } | null;
  /** Rested for less than this parcel's target. Worked out where the target is. */
  underTarget: boolean;
  history: {
    id: string;
    use: string;
    isProductive: boolean;
    startedOn: string;
    endedOn: string | null;
  }[];
}

export function ZoneTable({
  parcelId,
  zones,
  unit,
  zoneWord,
  today,
  usesInUse,
  canEdit,
  basePath,
}: {
  parcelId: string;
  zones: ZoneRow[];
  unit: AreaUnit;
  zoneWord: string;
  today: string;
  usesInUse: string[];
  canEdit: boolean;
  basePath: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [useFilter, setUseFilter] = useState<string>(EVERY_USE);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [ascending, setAscending] = useState(true);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  /** Only the uses actually declared here. An option matching nothing is a dead end. */
  const uses = useMemo(() => {
    const present = new Set(
      zones.map((zone) => zone.use?.use).filter((use): use is string => !!use),
    );
    return [...present]
      .map((use) => ({ use, label: zoneUseLabel(use) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [zones]);

  /**
   * The use filter actually in force — derived, not reset in an effect.
   *
   * Retiring the last hay paddock takes "Hay" out of the options, and a filter
   * naming something that is gone leaves an empty list with no clue why. The
   * plan list learned this the same way, by being driven.
   */
  const effectiveUse =
    useFilter === EVERY_USE ||
    useFilter === NO_USE ||
    uses.some((u) => u.use === useFilter)
      ? useFilter
      : EVERY_USE;

  const listed = useMemo(() => {
    const matchesStatus = STATUS_FILTERS[statusFilter].match;
    const rows = zones.filter((zone) => {
      if (!matchesStatus(zone.status)) return false;
      if (effectiveUse === EVERY_USE) return true;
      if (effectiveUse === NO_USE) return zone.use === null;
      return zone.use?.use === effectiveUse;
    });

    const direction = ascending ? 1 : -1;
    return rows.sort((a, b) => {
      if (sortKey === "area" || sortKey === "rest") {
        /**
         * **ROWS WITH NO NUMBER SINK IN BOTH DIRECTIONS**, the rule the plan
         * list's Length column follows. Sorting by rest is asking which ground
         * has had the longest break; a paddock with cattle on it and one that
         * has never been grazed answer neither, and floating them to the top on
         * the descending pass would bury the answer under them.
         */
        const left =
          sortKey === "area" ? a.areaAcres : (a.rest?.restDays ?? null);
        const right =
          sortKey === "area" ? b.areaAcres : (b.rest?.restDays ?? null);
        if (left === null && right === null) return a.name.localeCompare(b.name);
        if (left === null) return 1;
        if (right === null) return -1;
        const order = left - right;
        return order === 0 ? a.name.localeCompare(b.name) : order * direction;
      }

      const key = (zone: ZoneRow) =>
        sortKey === "name" ? zone.name : zone.use ? zoneUseLabel(zone.use.use) : "";
      // An undeclared use sorts last whichever way round, for the same reason a
      // missing number does: "nothing yet" is not a value on the scale.
      const left = key(a);
      const right = key(b);
      if (left === "" && right !== "") return 1;
      if (right === "" && left !== "") return -1;
      const order = left.localeCompare(right);
      return order === 0
        ? a.name.localeCompare(b.name)
        : order * direction;
    });
  }, [ascending, effectiveUse, sortKey, statusFilter, zones]);

  /**
   * What "Retire 5" would actually retire.
   *
   * **NARROWED TO WHAT IS ON SCREEN, ALWAYS** — and to what can still be
   * retired. Tick four, switch the filter to Retired, and the ticks must stop
   * counting: a button whose number includes rows you cannot see is how
   * somebody archives a paddock they never looked at.
   */
  const selected = useMemo(
    () =>
      listed.filter(
        (zone) => checked.has(zone.id) && zone.status === "active",
      ),
    [checked, listed],
  );

  const retiredCount = zones.filter((zone) => zone.status === "retired").length;
  /** Only rows something can be done to are worth a tick. */
  const selectable = listed.filter((zone) => zone.status === "active");
  const allShown =
    selectable.length > 0 && selectable.every((zone) => checked.has(zone.id));

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
      const next = new Set(current);
      for (const zone of selectable) {
        if (allShown) next.delete(zone.id);
        else next.add(zone.id);
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

  function retire() {
    const ids = selected.map((zone) => zone.id);
    startTransition(async () => {
      const result = await retireZonesAction({ ids, endedOn: today });
      setConfirming(false);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setChecked(new Set());
      toast.success(`${ids.length} retired`);
      router.refresh();
    });
  }

  const word = zoneWord.toLowerCase();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={effectiveUse} onValueChange={setUseFilter}>
          <SelectTrigger className="h-8 w-auto min-w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EVERY_USE}>Every use</SelectItem>
            <SelectItem value={NO_USE}>Not set</SelectItem>
            {uses.map((use) => (
              <SelectItem key={use.use} value={use.use}>
                {use.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
        >
          <SelectTrigger className="h-8 w-auto min-w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_FILTERS) as StatusFilter[]).map((key) => (
              <SelectItem key={key} value={key}>
                {STATUS_FILTERS[key].label}
                {key === "retired" && retiredCount > 0
                  ? ` (${retiredCount})`
                  : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          {listed.length === zones.length
            ? `${zones.length} shown`
            : `${listed.length} of ${zones.length}`}
        </span>

        {canEdit && selected.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            className={`ml-auto ${confirming ? "text-destructive" : "text-muted-foreground"}`}
            onClick={() => (confirming ? retire() : setConfirming(true))}
          >
            <Archive className="mr-2 h-4 w-4" />
            {confirming
              ? `Retire ${selected.length}? Their history is kept`
              : `Retire ${selected.length}`}
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
                  aria-label={`Select every ${word} shown`}
                  disabled={selectable.length === 0}
                />
              </TableHead>
            )}
            <SortHeader
              label={zoneWord}
              onClick={() => sortOn("name")}
              active={sortKey === "name"}
              ascending={ascending}
            />
            <SortHeader
              label="Currently"
              onClick={() => sortOn("use")}
              active={sortKey === "use"}
              ascending={ascending}
            />
            <SortHeader
              label="Rested"
              onClick={() => sortOn("rest")}
              active={sortKey === "rest"}
              ascending={ascending}
            />
            <SortHeader
              label="Area"
              onClick={() => sortOn("area")}
              active={sortKey === "area"}
              ascending={ascending}
              alignRight
            />
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {listed.map((zone) => (
            <TableRow key={zone.id}>
              {canEdit && (
                <TableCell>
                  {zone.status === "active" && (
                    <Checkbox
                      checked={checked.has(zone.id)}
                      onCheckedChange={() => toggle(zone.id)}
                      aria-label={`Select ${zone.name}`}
                    />
                  )}
                </TableCell>
              )}
              <TableCell className="font-medium">
                <Link
                  href={`${basePath}/${parcelId}/zones/${zone.id}`}
                  className="hover:underline"
                >
                  {zone.name}
                </Link>
                {zone.status === "retired" && (
                  <Badge variant="outline" className="ml-2">
                    retired
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {zone.use ? (
                  <span className="flex items-center gap-2">
                    {zoneUseLabel(zone.use.use)}
                    {!zone.use.isProductive && (
                      <Badge variant="outline">not productive</Badge>
                    )}
                    <span className="text-xs">since {zone.use.startedOn}</span>
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {/* Computed from occupancy, never stored, and never entered a
                    second time. "Never used" is not the same fact as "rested a
                    long time". */}
                {zone.rest?.status === "occupied" ? (
                  <Badge variant="outline">occupied</Badge>
                ) : zone.rest?.status === "never_grazed" ? (
                  "—"
                ) : (
                  <span className="tabular-nums">
                    {formatDays(zone.rest?.restDays ?? null)}
                    {zone.underTarget && (
                      <span className="ml-2 text-xs">under target</span>
                    )}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatArea(zone.areaAcres, unit)}
              </TableCell>
              <TableCell>
                {canEdit && zone.status === "active" && (
                  <ZoneControls
                    zone={{
                      id: zone.id,
                      name: zone.name,
                      areaInput:
                        zone.areaAcres === null
                          ? ""
                          : String(fromAcres(zone.areaAcres, unit)),
                      notes: zone.notes,
                      history: zone.history,
                    }}
                    unit={unit}
                    zoneWord={zoneWord}
                    today={today}
                    usesInUse={usesInUse}
                  />
                )}
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
