"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Combine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { combineParcelsAction } from "../actions";
import { formatArea, type AreaUnit } from "../core/area";

export interface CombinableParcel {
  id: string;
  name: string;
  identifier: string;
  areaAcres: number | null;
  zoneCount: number;
}

/**
 * Combine parcels the county keeps apart and the farm works as one.
 *
 * **THE CONSTRAINT THAT FORCES THIS IS NOT TIDINESS.** A zone belongs to
 * exactly one parcel, so a fence line crossing a deed boundary is a paddock
 * this app cannot draw. The founder imported five parcels from the county and
 * immediately hit it: two adjacent 4.12-acre deeds on Paige Rd, farmed as one
 * block.
 *
 * The dialog says what will happen before it happens, because two of the three
 * effects are invisible afterwards: paddocks move, and the absorbed parcels are
 * retired rather than deleted.
 */
export function CombineParcelsBar({
  parcels,
  unit,
}: {
  parcels: CombinableParcel[];
  unit: AreaUnit;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [survivorId, setSurvivorId] = useState("");
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  const selected = useMemo(
    () => parcels.filter((parcel) => chosen.has(parcel.id)),
    [parcels, chosen],
  );

  const totals = useMemo(() => {
    const acres = selected.reduce((sum, parcel) => sum + (parcel.areaAcres ?? 0), 0);
    return {
      acres,
      // "Not recorded" poisons a total rather than counting as nothing — the
      // same rule `totalArea` follows everywhere else in this pack.
      unknown: selected.filter((parcel) => parcel.areaAcres === null).length,
      zones: selected.reduce((sum, parcel) => sum + parcel.zoneCount, 0),
    };
  }, [selected]);

  function toggle(id: string) {
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function start() {
    const first = selected[0];
    setSurvivorId(first.id);
    setName(first.name);
    setOpen(true);
  }

  function submit() {
    const survivor = selected.find((parcel) => parcel.id === survivorId);
    if (!survivor) return;
    startTransition(async () => {
      const result = await combineParcelsAction({
        survivorId,
        absorbedIds: selected
          .filter((parcel) => parcel.id !== survivorId)
          .map((parcel) => parcel.id),
        name,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.zonesMoved
          ? `Combined into ${result.name}, and ${result.zonesMoved} moved with it.`
          : `Combined into ${result.name}.`,
      );
      setOpen(false);
      setChosen(new Set());
      router.refresh();
    });
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border p-3 text-sm">
          <span className="text-muted-foreground">Combine</span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {parcels.map((parcel) => (
              <label key={parcel.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={chosen.has(parcel.id)}
                  onChange={() => toggle(parcel.id)}
                />
                <span>{parcel.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatArea(parcel.areaAcres, unit)}
                </span>
              </label>
            ))}
          </div>
          <Button
            size="sm"
            className="ml-auto"
            disabled={selected.length < 2}
            onClick={start}
          >
            <Combine className="mr-2 h-4 w-4" />
            {selected.length < 2
              ? "Combine parcels"
              : `Combine ${selected.length} parcels`}
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Combine into one parcel</DialogTitle>
            <DialogDescription>
              The county still knows these as separate deeds and always will —
              both parcel numbers are kept on the result. Nothing is deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="survivor">Keep the record for</Label>
              <Select value={survivorId} onValueChange={setSurvivorId}>
                <SelectTrigger id="survivor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selected.map((parcel) => (
                    <SelectItem key={parcel.id} value={parcel.id}>
                      {parcel.name}
                      {parcel.identifier ? ` · ${parcel.identifier}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {/* Said plainly because it is the one thing that cannot be
                    undone later: the survivor keeps its history. */}
                This one keeps its id, so every cost and every journal line
                already tagged to it follows the combined parcel. The others are
                retired.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="combined-name">Call it</Label>
              <Input
                id="combined-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">What happens</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                <li>
                  {selected.length} parcels become one
                  {totals.unknown > 0
                    ? ", and its area stays unrecorded because one of them has none"
                    : `, at ${formatArea(totals.acres, unit)}`}
                  .
                </li>
                <li>
                  The boundaries are kept as separate pieces of the same parcel,
                  so the acreage stays exact whether or not they touch.
                </li>
                {totals.zones > 0 && (
                  <li>
                    {totals.zones} paddock{totals.zones === 1 ? "" : "s"} move
                    across and stay active.
                  </li>
                )}
                <li>
                  The other {selected.length - 1} are retired, not deleted — and
                  a retired parcel cannot currently be brought back.
                </li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={submit} disabled={pending || !survivorId}>
              {pending ? "Combining…" : "Combine"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
