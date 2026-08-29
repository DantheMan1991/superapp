"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Split } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { layoutPaddocksAction } from "../actions";
import { MAX_PADDOCKS } from "../core/subdivide";

/**
 * Divide ground into paddocks along a lane.
 *
 * **THERE IS NO SEPARATE PREVIEW, AND THAT IS THE POINT OF `planned`.** What
 * this produces is proposed paddocks and proposed fences, ghosted on the plan
 * exactly as any other proposal — so the preview IS the result, and adjusting
 * it is dragging a fence rather than re-running a dialog with different
 * numbers. Nothing here becomes real until somebody has been out and built it.
 *
 * The lane is picked rather than drawn here: it is the spine everything hangs
 * off, and the honest way to get one is to WALK it (slice 2b.1), not to guess
 * at it in a modal.
 */
export function PaddockLayout({
  parcelId,
  lanes,
  areas,
  zoneWord,
}: {
  parcelId: string;
  /** Lane-ish features that actually have geometry — nothing else can be a spine. */
  lanes: { id: string; label: string }[];
  /** The ground on offer: the parcel itself, and any zone with a boundary. */
  areas: { id: string | null; label: string }[];
  zoneWord: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [laneId, setLaneId] = useState(lanes[0]?.id ?? "");
  const [areaId, setAreaId] = useState<string>("__parcel__");

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await layoutPaddocksAction({
        parcelId,
        zoneId: areaId === "__parcel__" ? null : areaId,
        laneFeatureId: laneId,
        count: Number(formData.get("count") ?? 0),
        namePrefix: String(formData.get("namePrefix") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // **THE WARNINGS ARE SHOWN, NOT SWALLOWED.** A paddock the cows cannot
      // walk to is the one failure this layout exists to prevent, and it is
      // reported rather than refused — the shape is real and a drag handle
      // fixes it better than an algorithm guessing.
      const warnings = "warnings" in result ? (result.warnings as string[]) : [];
      for (const warning of warnings) toast.warning(warning);
      toast.success(
        warnings.length > 0
          ? "Laid out, with something to look at"
          : "Laid out as proposals",
      );
      setOpen(false);
      router.refresh();
    });
  }

  if (lanes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Draw or walk a lane to divide this ground into {zoneWord.toLowerCase()}s.
      </p>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Split className="mr-2 h-4 w-4" />
          Divide into {zoneWord.toLowerCase()}s
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Divide into {zoneWord.toLowerCase()}s</DialogTitle>
          <DialogDescription>
            Equal areas, cut across the lane so every one of them touches it.
            They arrive as proposals — drag anything that is not where you want
            it, then mark them built once the fence is in.
          </DialogDescription>
        </DialogHeader>

        <form action={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="area">Ground to divide</Label>
            <Select value={areaId} onValueChange={setAreaId}>
              <SelectTrigger id="area">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {areas.map((area) => (
                  <SelectItem key={area.id ?? "__parcel__"} value={area.id ?? "__parcel__"}>
                    {area.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lane">Lane</Label>
            <Select value={laneId} onValueChange={setLaneId}>
              <SelectTrigger id="lane">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {lanes.map((lane) => (
                  <SelectItem key={lane.id} value={lane.id}>
                    {lane.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The cuts run across it, so every {zoneWord.toLowerCase()} has
              frontage onto it.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="count">How many</Label>
              <Input
                id="count"
                name="count"
                type="number"
                min={2}
                max={MAX_PADDOCKS}
                defaultValue={4}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="namePrefix">Called</Label>
              <Input
                id="namePrefix"
                name="namePrefix"
                placeholder="Paddock"
                maxLength={60}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || !laneId}>
              {pending ? "Laying out…" : "Lay them out"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
