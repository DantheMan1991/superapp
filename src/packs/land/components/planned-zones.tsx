"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { activateZoneAction, discardZonesAction } from "../actions";
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
 *
 * **DISCARDING IS THE OTHER ACT, and until 2026-08-30 there was not one.** The
 * founder ran a layout on production, changed his mind, deleted every fence it
 * drew — and the paddocks stayed, purple on the map, with no control anywhere
 * that would clear them. Deleting the plan does not do it either: a plan owns
 * the FEATURES it proposed, not the ground. Discarding is offered ALL AT ONCE
 * as well as per row, because changing your mind about a layout is one decision
 * about twelve paddocks, not twelve decisions.
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
  /**
   * Which discard has been asked for and not yet confirmed.
   *
   * **CONFIRMED IN PLACE RATHER THAN IN A DIALOG.** A modal for "are you sure"
   * on a proposal is heavier than the decision deserves; a button that changes
   * to "Sure?" for one click is enough to catch the mis-tap, which is the only
   * thing being guarded against. `"all"` is the same state for the bulk button.
   */
  const [confirming, setConfirming] = useState<string | null>(null);

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

  function discard(ids: string[], what: string) {
    startTransition(async () => {
      const result = await discardZonesAction({ ids });
      setConfirming(null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${what} discarded`);
      router.refresh();
    });
  }

  const word = zoneWord.toLowerCase();

  return (
    <div className="mt-3 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">
          Proposed {word}s
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
              <span className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => activate(zone.id, zone.name)}
                >
                  <Check className="mr-2 h-4 w-4" />
                  The fence is in
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  className={
                    confirming === zone.id
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                  onClick={() =>
                    confirming === zone.id
                      ? discard([zone.id], zone.name)
                      : setConfirming(zone.id)
                  }
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {confirming === zone.id ? "Sure?" : "Discard"}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {canActivate && zones.length > 1 && (
        <div className="mt-3 flex justify-end border-t border-dashed pt-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            className={
              confirming === "all" ? "text-destructive" : "text-muted-foreground"
            }
            onClick={() =>
              confirming === "all"
                ? discard(
                    zones.map((zone) => zone.id),
                    `${zones.length} proposed ${word}s`,
                  )
                : setConfirming("all")
            }
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {confirming === "all"
              ? `Discard all ${zones.length}?`
              : `Discard all ${zones.length}`}
          </Button>
        </div>
      )}
    </div>
  );
}
