"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTable } from "@/components/app/data-table";
import { importParcelsAction, lookupParcelsAction } from "../actions";
import { formatArea, type AreaUnit } from "../core/area";
import type { ParcelSearchKind } from "../core/parcel-lookup";

interface Candidate {
  parcelNumber: string;
  situsAddress: string | null;
  mailingAddress: string | null;
  declaredAcres: number | null;
  measuredAcres: number;
  suggestedName: string;
  geojson: string;
}

/**
 * Find your own ground in the county record, and take the parts that are yours.
 *
 * **THE WHOLE FARM IN ONE SEARCH.** A mailing-address search on Knox County
 * returns nine parcels across four roads and 462 acres — which is what a farm
 * looks like in the records, and what makes this worth building over tracing by
 * hand. The tick boxes are the point: the county groups by where the tax bill
 * goes, so a trust, an LLC or a farm manager's address will pull in ground that
 * is not yours. It proposes, you dispose.
 */
export function ParcelFinder({
  sources,
  defaultRegion,
  unit,
}: {
  /** Every service this tenant may search. IDs only — never URLs. */
  sources: {
    id: string;
    label: string;
    regionLabel: string;
    needsRegion: boolean;
  }[];
  defaultRegion: string;
  unit: AreaUnit;
}) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const source = sources.find((s) => s.id === sourceId) ?? sources[0];
  const [kind, setKind] = useState<ParcelSearchKind>("mailing_address");
  const [region, setRegion] = useState(defaultRegion);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [attribution, setAttribution] = useState("");
  const [currency, setCurrency] = useState<{
    oldest: string;
    newest: string;
    uniform: boolean;
  } | null>(null);
  const [searching, startSearch] = useTransition();
  const [importing, startImport] = useTransition();

  function search() {
    startSearch(async () => {
      const result = await lookupParcelsAction({ kind, query, region, sourceId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCandidates(result.candidates ?? []);
      setAttribution(result.attribution ?? "");
      setCurrency(result.currency ?? null);
      // Nothing pre-ticked. Every row here is a guess about what somebody owns,
      // and a pre-ticked guess is how land nobody owns ends up in the books.
      setChosen(new Set());
    });
  }

  function toggle(parcelNumber: string) {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(parcelNumber)) next.delete(parcelNumber);
      else next.add(parcelNumber);
      return next;
    });
  }

  function importChosen() {
    const rows = (candidates ?? []).filter((c) => chosen.has(c.parcelNumber));
    if (rows.length === 0) return;
    startImport(async () => {
      const result = await importParcelsAction({
        parcels: rows.map((row) => ({
          name: row.suggestedName,
          parcelNumber: row.parcelNumber,
          declaredAcres: row.declaredAcres,
          geojson: row.geojson,
        })),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const n = result.created ?? rows.length;
      toast.success(n === 1 ? "1 parcel added" : `${n} parcels added`);
      router.push("/dashboard/m/land");
      router.refresh();
    });
  }


  /**
   * **A SEARCH THAT FINDS FOUR OF YOUR FIVE PARCELS IS NOT BROKEN — IT IS OLD.**
   * Every Knox County parcel in Ohio's statewide layer is one snapshot from
   * 2023-05-16, so a parcel split off its parent since then is not in the state
   * copy at all and the parent still carries the previous owner's address. The
   * founder's own 19-acre split was invisible for exactly that reason, and
   * without this line it reads as a bug in the search.
   *
   * The date is READ from the service on every search, so it moves the moment
   * the county's contribution is refreshed.
   */
  const currencyNote = currency ? (
    <p className="text-xs text-muted-foreground">
      {source?.regionLabel ?? "County"} records here are as of{" "}
      <span className="font-medium">
        {currency.uniform
          ? currency.newest
          : `${currency.oldest} to ${currency.newest}`}
      </span>
      . Anything split, sold or re-parcelled since then will be missing, or will
      still show its previous owner — search the parent parcel number and adjust
      the boundary, or trace it on the map.
    </p>
  ) : null;

  const chosenAcres = (candidates ?? [])
    .filter((c) => chosen.has(c.parcelNumber))
    .reduce((sum, c) => sum + (c.declaredAcres ?? c.measuredAcres), 0);

  return (
    <div className="space-y-6">
      <div className="rounded-md border p-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px_160px_minmax(0,1fr)_auto] sm:items-end">
          {sources.length > 1 && (
            <div className="grid gap-2">
              <Label htmlFor="source">Records from</Label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger id="source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="kind">Search by</Label>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as ParcelSearchKind)}
            >
              <SelectTrigger id="kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mailing_address">Tax mailing address</SelectItem>
                <SelectItem value="parcel_number">Parcel number</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {source?.needsRegion && (
            <div className="grid gap-2">
              <Label htmlFor="region">{source.regionLabel}</Label>
              <Input
                id="region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="Knox"
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="query">
              {kind === "parcel_number" ? "Parcel number" : "Mailing address"}
            </Label>
            <Input
              id="query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") search();
              }}
              placeholder={
                kind === "parcel_number"
                  ? "29-004-03-000"
                  : "11729 Leedy Rd"
              }
            />
          </div>

          <Button onClick={search} disabled={searching || query.trim().length < 3}>
            <Search className="mr-2 h-4 w-4" />
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {/* Said plainly, because the dashes matter to a person and not at all
              to the service. */}
          {kind === "parcel_number"
            ? "Dashes and spaces are ignored — type it however it appears on the bill."
            : `Every parcel whose tax bill goes to this address, from ${source?.label ?? "the county"}. That is how the county groups a holding, so it usually finds the whole farm at once.`}
        </p>
      </div>

      {candidates !== null && candidates.length === 0 && (
        <div className="space-y-3 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          <p>
            Nothing matched. Check the{" "}
            {(source?.regionLabel ?? "county").toLowerCase()}, and try fewer
            words — the county stores addresses in its own way and a partial one
            matches more.
          </p>
          {currencyNote}
        </div>
      )}

      {candidates !== null && candidates.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium">
              {candidates.length} found
              {chosen.size > 0 && (
                <span className="font-normal text-muted-foreground">
                  {" · "}
                  {chosen.size} chosen, {formatArea(chosenAcres, unit)}
                </span>
              )}
            </h2>
            <Button onClick={importChosen} disabled={importing || chosen.size === 0}>
              {importing
                ? "Adding…"
                : chosen.size === 1
                  ? "Add 1 parcel"
                  : `Add ${chosen.size} parcels`}
            </Button>
          </div>

          <DataTable>
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Parcel</TableHead>
                <TableHead>Where</TableHead>
                <TableHead className="text-right">County acres</TableHead>
                <TableHead className="text-right">Measured</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.map((candidate) => (
                <TableRow key={candidate.parcelNumber}>
                  <TableCell>
                    {/* A plain input, which is what this design system uses —
                        there is no Checkbox primitive and inventing one for a
                        single screen is how a design system stops being one. */}
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={chosen.has(candidate.parcelNumber)}
                      onChange={() => toggle(candidate.parcelNumber)}
                      aria-label={`Choose parcel ${candidate.parcelNumber}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{candidate.suggestedName}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {candidate.parcelNumber}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {candidate.mailingAddress ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {/* The county's own figure. Null is not zero: plenty of
                        parcels have never been measured. */}
                    {candidate.declaredAcres === null
                      ? "—"
                      : formatArea(candidate.declaredAcres, unit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatArea(candidate.measuredAcres, unit)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            </Table>
          </DataTable>

          {attribution && (
            <p className="text-xs text-muted-foreground">Source: {attribution}</p>
          )}
          {currencyNote}
          <p className="text-xs text-muted-foreground">
            Tick only the ground that is yours. This searches by where the tax
            bill goes, which groups a holding well and is not proof of ownership
            — a shared address pulls in a neighbour&rsquo;s field.
          </p>
        </div>
      )}

      {candidates === null && (
        <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            The county already drew your boundaries.
          </p>
          <p className="mt-1">
            Search for them and they arrive with their acreage, ready to have
            paddocks traced inside them. Nothing is added until you tick it.
          </p>
          <Badge variant="outline" className="mt-3">
            {source?.label ?? "No source"}
          </Badge>
        </div>
      )}
    </div>
  );
}
