"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/app/use-confirm";
import { unretireParcelAction, unretireZoneAction } from "../actions";

/**
 * Putting retired ground back.
 *
 * **RETIREMENT WAS NEVER MEANT TO BE A ONE-WAY DOOR.** The pack retires rather
 * than deletes precisely because the history is worth keeping — the row is all
 * still there, every cost tagged to it still reports, and the only thing
 * standing between a mis-click and its undo was that nobody had written the
 * other half. The dossier carried it as an open item from slice 0: *"a harsher
 * rule than intended for what is often a mis-click."*
 *
 * Owner, like the retirement it reverses: both ends move a cost object.
 */
export function UnretireParcel({
  id,
  name,
  parcelWord,
  zoneWord,
}: {
  id: string;
  name: string;
  /** Both words are the tenant's. See the 2026-09-10 vocabulary entry. */
  parcelWord: string;
  zoneWord: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();

  async function act() {
    /**
     * **THE DIALOG HAS TO SAY WHAT THIS DOES NOT DO**, because a person
     * pressing it is undoing something and will assume it undoes all of it.
     * Retiring a parcel cascaded to its ground; bringing it back does not,
     * because nothing recorded which of the retired ones went with the cascade
     * and which were retired months earlier on their own account. And it never
     * undoes a combine: the absorbed parcel comes back empty, its ground having
     * moved to the survivor.
     */
    if (
      !(await confirm({
        title: `Put ${name} back?`,
        description: `It goes back to being ground the business holds, and it can be reported on and built on again. Its ${zoneWord.toLowerCase()}s stay retired — put each one back from the table when you want it. If this ${parcelWord.toLowerCase()} was combined into another, this does not undo that: the ground moved across and does not come back with it.`,
        confirmLabel: "Put it back",
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await unretireParcelAction({ id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.zonesStillRetired > 0
          ? `${name} is back — ${result.zonesStillRetired} ${zoneWord.toLowerCase()}${result.zonesStillRetired === 1 ? "" : "s"} on it are still retired`
          : `${name} is back`,
      );
      router.refresh();
    });
  }

  return (
    <>
      {confirmDialog}
      <Button size="sm" variant="outline" onClick={act} disabled={pending}>
        <Undo2 className="mr-2 h-4 w-4" />
        {pending ? "Putting it back…" : "Put it back"}
      </Button>
    </>
  );
}

/** The same for one piece of ground inside a parcel. */
export function UnretireZone({
  id,
  name,
  zoneWord,
  trigger,
}: {
  id: string;
  name: string;
  zoneWord: string;
  /** A row wants a small ghost button; a page header wants the default. */
  trigger?: "row" | "header";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();

  async function act() {
    if (
      !(await confirm({
        title: `Put ${name} back?`,
        description: `It can be used and reported on again, and everything already recorded against it is unchanged. Whatever it was for stays closed — that was true on the day it was retired — so say what it is for now once it is back.`,
        confirmLabel: "Put it back",
      }))
    ) {
      return;
    }
    startTransition(async () => {
      const result = await unretireZoneAction({ id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name} is back`);
      router.refresh();
    });
  }

  return (
    <>
      {confirmDialog}
      <Button
        size="sm"
        variant={trigger === "row" ? "ghost" : "outline"}
        onClick={act}
        disabled={pending}
        aria-label={`Put ${name} back`}
      >
        <Undo2 className="mr-2 h-4 w-4" />
        {pending ? "Putting it back…" : `Put ${trigger === "row" ? "back" : `the ${zoneWord.toLowerCase()} back`}`}
      </Button>
    </>
  );
}
