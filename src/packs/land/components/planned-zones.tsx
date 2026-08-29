"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { activateZoneAction } from "../actions";
import { formatArea, type AreaUnit } from "../core/area";

/**
 * Ground a layout proposed, waiting for somebody to go and fence it.
 *
 * **SEPARATE FROM THE PADDOCK TABLE, NOT MIXED INTO IT.** That table's columns
 * are about ground you are using — what is on it, how long it has rested — and
 * every one of them is meaningless for a paddock with no fence round it. A
 * planned row in that table would show four dashes and a rest figure computed
 * from nothing, which reads as a broken paddock rather than an unbuilt one.
 *
 * ACTIVATING IS THE ACT, and it is per paddock rather than all at once: fences
 * go in one at a time, and marking four built because you finished the first is
 * how the map stops matching the ground.
 */
export function PlannedZones({
  zones,
  unit,
  zoneWord,
  canActivate,
}: {
  zones: { id: string; name: string; areaAcres: number | null }[];
  unit: AreaUnit;
  zoneWord: string;
  canActivate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function activate(id: string, name: string) {
    startTransition(async () => {
      const result = await activateZoneAction({ id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name} is in`);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">
          Proposed {zoneWord.toLowerCase()}s
          <span className="ml-2 font-normal text-muted-foreground">
            {zones.length}
          </span>
        </h3>
        <p className="text-xs text-muted-foreground">
          No fence round these yet. Nothing can graze them and they count
          towards nothing until you say they are in.
        </p>
      </div>

      <ul className="mt-3 space-y-1.5">
        {zones.map((zone) => (
          <li
            key={zone.id}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span className="flex items-center gap-2">
              <Badge variant="outline">Proposed</Badge>
              <span>{zone.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatArea(zone.areaAcres, unit)}
              </span>
            </span>
            {canActivate && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => activate(zone.id, zone.name)}
              >
                <Check className="mr-2 h-4 w-4" />
                The fence is in
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
