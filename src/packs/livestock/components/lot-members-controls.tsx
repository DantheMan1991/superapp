"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  addLotToParentAction,
  removeLotFromParentAction,
} from "../actions";

export type Joinable = {
  livestockLotId: string;
  code: string;
  species: string;
  head: number;
};

/**
 * **PUT ANIMALS IN A LOT** (slice 8b) — the founder's *"create lots and then add
 * individual animals to it"*, which before this slice was not possible at all.
 *
 * **MULTI-SELECT, because the act is plural.** Six cows going in the north pen
 * is one decision and six dialogs would be the friction that made naming
 * animals unusable in the first place.
 *
 * The list is already filtered by `lotsAvailableToJoin` to what the write path
 * will accept, so nothing offered here can be refused for nesting.
 */
export function AddToLotForm({
  parentLotId,
  candidates,
  today,
  word,
}: {
  parentLotId: string;
  candidates: Joinable[];
  today: string;
  /** The tenant's word for a group of animals — "Lot", "Flock", "Pen". */
  word: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [startedOn, setStartedOn] = useState(today);
  const lower = word.toLowerCase();

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    if (picked.size === 0) return;
    startTransition(async () => {
      const result = await addLotToParentAction({
        parentLotId,
        memberLotIds: [...picked],
        startedOn,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.count === 1 ? "Added" : `${result.count} added`,
      );
      setPicked(new Set());
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Add animals
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to this {lower}</DialogTitle>
          <DialogDescription>
            Named animals and whole {lower}s both. Anything already in another
            one moves across.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nothing to add. Everything else is either in another {lower} already
            or is holding animals of its own.
          </p>
        ) : (
          <div className="grid gap-4 py-4">
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {candidates.map((c) => (
                <label
                  key={c.livestockLotId}
                  className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={picked.has(c.livestockLotId)}
                    onCheckedChange={() => toggle(c.livestockLotId)}
                  />
                  <span className="flex-1 text-sm font-medium">{c.code}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.head} head
                  </span>
                </label>
              ))}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="startedOn">From</Label>
              <Input
                id="startedOn"
                type="date"
                value={startedOn}
                onChange={(e) => setStartedOn(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={pending || picked.size === 0}
          >
            {pending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Take one animal or sub-lot back out, leaving it in none. */
export function TakeOutOfLotButton({
  memberLotId,
  code,
  today,
}: {
  memberLotId: string;
  code: string;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={`Take ${code} out of this lot`}
      onClick={() =>
        startTransition(async () => {
          const result = await removeLotFromParentAction({
            memberLotId,
            endedOn: today,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          // NOT a head event, and the toast says so: she is still on the farm,
          // still in the ledger, just not in this lot any more.
          toast.success(`${code} taken out — still on the farm`);
          router.refresh();
        })
      }
    >
      {pending ? "…" : "Take out"}
    </Button>
  );
}
