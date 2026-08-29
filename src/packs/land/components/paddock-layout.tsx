"use client";

import { useMemo, useState, useTransition } from "react";
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
import {
  compareLayouts,
  DEFAULT_LANE_WIDTH_M,
  MAX_PADDOCKS,
  type LanePlacement,
  type LayoutOption,
} from "../core/subdivide";
import { asBoundary, asFeatureGeometry } from "../core/geo";
import { formatArea, type AreaUnit } from "../core/area";
import { formatLength, fromMetres, toMetres, type LengthUnit } from "../core/length";

export interface LayoutArea {
  id: string | null;
  label: string;
  geometry: unknown;
}

export interface LayoutLane {
  id: string;
  label: string;
  geometry: unknown;
}

const PLACEMENT_LABEL: Record<LanePlacement, string> = {
  edge: "One side of the lane",
  split: "Both sides of the lane",
};

/**
 * Divide ground into paddocks along a lane.
 *
 * **THE TWO LAYOUTS ARE COSTED SIDE BY SIDE RATHER THAN CHOSEN FOR YOU.** An
 * edge lane puts paddocks on one side and leaves the other out of the
 * rotation; a split lane puts them on both, for a second run of lane fence.
 * Which is better depends on the shape of the ground and on how much fence is
 * already there, and the app has no business guessing — so both are computed
 * from the real geometry as the numbers are typed, and the deciding figure
 * (fence per acre) is shown for each.
 *
 * **THERE IS NO SEPARATE PREVIEW OF THE SHAPES, AND THAT IS THE POINT OF
 * `planned`.** What this produces is proposed paddocks and proposed fences,
 * ghosted on the plan exactly as any other proposal — so the preview IS the
 * result, and adjusting it means dragging a fence rather than re-running a
 * dialog with different numbers.
 */
export function PaddockLayout({
  parcelId,
  lanes,
  areas,
  zoneWord,
  areaUnit,
  lengthUnit,
}: {
  parcelId: string;
  lanes: LayoutLane[];
  areas: LayoutArea[];
  zoneWord: string;
  areaUnit: AreaUnit;
  lengthUnit: LengthUnit;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [laneId, setLaneId] = useState(lanes[0]?.id ?? "");
  const [areaId, setAreaId] = useState<string>("__parcel__");
  const [count, setCount] = useState(4);
  const [laneWidth, setLaneWidth] = useState(
    Math.round(fromMetres(DEFAULT_LANE_WIDTH_M, lengthUnit)),
  );
  const [placement, setPlacement] = useState<LanePlacement>("split");
  const [namePrefix, setNamePrefix] = useState("");

  const options = useMemo<LayoutOption[]>(() => {
    const area = areas.find((a) => (a.id ?? "__parcel__") === areaId);
    const lane = lanes.find((l) => l.id === laneId);
    const boundary = area ? asBoundary(area.geometry) : null;
    const spine = lane ? asFeatureGeometry(lane.geometry) : null;
    if (!boundary || !spine || !Number.isInteger(count) || count < 2) return [];
    // The SAME function the server will run, so the numbers on screen are the
    // ones that get built — the discipline the length readout already follows.
    return compareLayouts(
      boundary,
      spine,
      count,
      Math.max(0.5, toMetres(laneWidth, lengthUnit)),
    );
  }, [areaId, areas, count, laneId, laneWidth, lanes, lengthUnit]);

  const chosen = options.find((option) => option.placement === placement);
  const best = options.reduce<LayoutOption | null>(
    (winner, option) =>
      !winner || option.fencePerAcreM < winner.fencePerAcreM ? option : winner,
    null,
  );

  function submit() {
    startTransition(async () => {
      const result = await layoutPaddocksAction({
        parcelId,
        zoneId: areaId === "__parcel__" ? null : areaId,
        laneFeatureId: laneId,
        count,
        placement,
        laneWidthM: Math.max(0.5, toMetres(laneWidth, lengthUnit)),
        namePrefix,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Divide into {zoneWord.toLowerCase()}s</DialogTitle>
          <DialogDescription>
            Equal areas, cut across the lane so every one of them has frontage
            onto it. The lane keeps its own ground — nothing is fenced across
            it. They arrive as proposals; mark them built once the fence is in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="area">Ground to divide</Label>
              <Select value={areaId} onValueChange={setAreaId}>
                <SelectTrigger id="area">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {areas.map((area) => (
                    <SelectItem
                      key={area.id ?? "__parcel__"}
                      value={area.id ?? "__parcel__"}
                    >
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
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="count">How many</Label>
              <Input
                id="count"
                type="number"
                min={2}
                max={MAX_PADDOCKS}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="laneWidth">Lane width</Label>
              <Input
                id="laneWidth"
                type="number"
                min={1}
                value={laneWidth}
                onChange={(event) => setLaneWidth(Number(event.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="namePrefix">Called</Label>
              <Input
                id="namePrefix"
                placeholder="Paddock"
                maxLength={60}
                value={namePrefix}
                onChange={(event) => setNamePrefix(event.target.value)}
              />
            </div>
          </div>

          {options.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Pick ground with a boundary and a lane that has been drawn.
            </p>
          ) : (
            <div className="space-y-2">
              <Label>Where the {zoneWord.toLowerCase()}s go</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {options.map((option) => (
                  <button
                    key={option.placement}
                    type="button"
                    onClick={() => setPlacement(option.placement)}
                    className={`rounded-md border p-3 text-left transition-colors ${
                      placement === option.placement
                        ? "border-primary bg-muted"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">
                        {PLACEMENT_LABEL[option.placement]}
                      </span>
                      {best?.placement === option.placement &&
                        options.length > 1 && (
                          <span className="text-[11px] text-muted-foreground">
                            least fence per acre
                          </span>
                        )}
                    </div>
                    <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                      <div className="flex justify-between gap-2">
                        <dt>Ground used</dt>
                        <dd className="tabular-nums">
                          {formatArea(option.acresInPaddocks, areaUnit)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Each</dt>
                        <dd className="tabular-nums">
                          {formatArea(option.acresPerPaddock, areaUnit)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>New fence</dt>
                        <dd className="tabular-nums">
                          {formatLength(option.fenceM, lengthUnit)}
                        </dd>
                      </div>
                    </dl>
                  </button>
                ))}
              </div>

              {chosen?.warnings.map((warning) => (
                <p key={warning} className="text-xs text-warning">
                  {warning}
                </p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || !laneId || !chosen}
          >
            {pending
              ? "Laying out…"
              : chosen
                ? `Lay out ${chosen.paddockCount}`
                : "Lay them out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
