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
  closeLivestockLotAction,
  removeLotFromParentAction,
  reopenLivestockLotAction,
  startIndividualAction,
} from "../actions";

export type Joinable = {
  livestockLotId: string;
  code: string;
  species: string;
  head: number;
};

/**
 * **PUT ANIMALS IN A LOT** — named ones that already exist, and **new ones
 * started right here.**
 *
 * The second half was the founder's complaint on 2026-08-28: *"I don't see how
 * to add individual animals to the lot. I see how I can increase head count,
 * which works for chickens but not when I want to track the individual
 * animal."*
 *
 * **HE WAS RIGHT, AND THE GAP WAS THE OBVIOUS CASE.** `lotsAvailableToJoin`
 * only ever offered lots that ALREADY EXISTED, so a lot created five seconds
 * ago showed *"Nothing to add"* — the one thing a person does immediately after
 * making a lot was the one thing this dialog could not do. Naming an animal
 * meant leaving for the hub, creating her loose, coming back, and picking her
 * out of a list. Four steps across two pages, and nothing said so.
 *
 * **Place head is not the same thing and never was.** It adds anonymous head,
 * which is exactly right for a hundred broilers and exactly wrong for a cow you
 * intend to weigh, treat and breed by name.
 *
 * **SHE INHERITS THE LOT'S SPECIES AND STOCK LINE**, so the form asks for a
 * name and nothing else. A cow going into the cattle lot is cattle; asking
 * again would be the app putting a question where it already has the answer.
 */
export function AddToLotForm({
  parentLotId,
  parentSpecies,
  parentSpeciesSlug,
  parentItemId,
  candidates,
  today,
  word,
}: {
  parentLotId: string;
  /** What is already in here, for the mixed-species warning. Display form. */
  parentSpecies: string;
  /** The same species as the slug the API wants. */
  parentSpeciesSlug: string;
  /** The stock line this lot is counted in, inherited by a new animal. */
  parentItemId: string;
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
  const [name, setName] = useState("");
  /**
   * **NEW FIRST when there is nothing to pick.** A farm whose every animal is
   * already somewhere would otherwise open on an empty list reading "nothing to
   * add", which is the exact dead end this rewrite exists to remove.
   */
  const [mode, setMode] = useState<"new" | "existing">(
    candidates.length === 0 ? "new" : "existing",
  );
  const isNew = mode === "new";
  const lower = word.toLowerCase();

  /**
   * **A MIXED SPECIES PICK IS WARNED, NEVER REFUSED** (slice 8d).
   *
   * Pigs and poultry on one paddock, moved together, is a homestead's ordinary
   * Tuesday — and a constraint that could not describe the pilot farm would be
   * describing something else.
   */
  const mixed = [
    ...new Set(
      candidates
        .filter((c) => picked.has(c.livestockLotId))
        .map((c) => c.species)
        .filter((sp) => sp !== parentSpecies),
    ),
  ];

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function done(message: string) {
    toast.success(message);
    setPicked(new Set());
    setName("");
    setOpen(false);
    router.refresh();
  }

  function submit() {
    if (isNew) {
      const trimmed = name.trim();
      if (!trimmed) return;
      startTransition(async () => {
        // One act: she is created, her single head is placed, and she is put in
        // this lot — in one transaction, so she exists in it or not at all.
        const result = await startIndividualAction({
          parentLotId,
          name: trimmed,
          species: parentSpeciesSlug,
          itemId: parentItemId,
          occurredOn: startedOn,
        });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        done(`${trimmed} added`);
      });
      return;
    }

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
      done(result.count === 1 ? "Added" : `${result.count} added`);
    });
  }

  const canSubmit = isNew ? name.trim().length > 0 : picked.size > 0;

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
            {isNew
              ? `One animal, with a page of her own — weights, treatments, photos and calves all hers. She joins this ${lower} and takes its species.`
              : `A named animal or a whole ${lower} that is already on the farm. Anything already in another one moves across.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* THE CHOICE FIRST, because it changes what the rest is asking for —
              the same lead the lot form uses for One animal / A lot. */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={isNew ? "default" : "outline"}
              onClick={() => setMode("new")}
            >
              A new animal
            </Button>
            <Button
              type="button"
              variant={isNew ? "outline" : "default"}
              onClick={() => setMode("existing")}
              disabled={candidates.length === 0}
            >
              One already here
            </Button>
          </div>

          {isNew ? (
            <div className="grid gap-2">
              <Label htmlFor="member-name">Name</Label>
              <Input
                id="member-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                autoFocus
                placeholder="e.g. Bluebell, #47"
              />
              <p className="text-xs text-muted-foreground">
                Kept as her name as well, so she is findable by it in a chute.
                Her one head is placed for you — this is not the same as adding
                to the head count, which is for animals nobody names.
              </p>
            </div>
          ) : (
            <>
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
              {mixed.length > 0 && (
                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  This {lower} holds {parentSpecies}, and you have picked{" "}
                  {mixed.join(" and ")}. That is allowed — a mixed {lower} is a
                  real thing — but head, feed and the daily round will report
                  them together.
                </p>
              )}
            </>
          )}

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

        <DialogFooter>
          <Button onClick={submit} disabled={pending || !canSubmit}>
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


/**
 * **CLOSE AN EMPTIED LOT, OR OPEN IT AGAIN.**
 *
 * The founder's PEN-2, 2026-08-28: a pen whose 50 broilers went to the
 * processor months ago, still on every list and still offered as something to
 * put animals into.
 *
 * **THE APP CANNOT INFER THIS.** A lot at zero head is either finished or about
 * to be filled, and the ledger says the same thing about both — so it is an act
 * somebody takes, and a reversible one. Offered only when there is nothing left
 * in it, which the server checks again.
 */
export function CloseLotButton({
  livestockLotId,
  code,
  closed,
  today,
  word,
}: {
  livestockLotId: string;
  code: string;
  closed: boolean;
  today: string;
  /** The tenant's word for a group of animals. */
  word: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const lower = word.toLowerCase();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = closed
            ? await reopenLivestockLotAction({ livestockLotId })
            : await closeLivestockLotAction({ livestockLotId, on: today });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          // Closing hides; it never deletes. The toast says which, because
          // "closed" beside a record somebody spent a season on wants to be
          // clearly reversible.
          toast.success(
            closed
              ? `${code} is back in the list`
              : `${code} closed — still in the records`,
          );
          router.refresh();
        })
      }
    >
      {pending ? "…" : closed ? `Reopen this ${lower}` : `Close this ${lower}`}
    </Button>
  );
}
