"use client";

import Link from "next/link";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useConfirm } from "@/components/app/use-confirm";
import {
  archiveItemAction,
  createItemAction,
  restoreItemAction,
  updateItemAction,
} from "../actions";
import { SUGGESTED_ITEM_KINDS, STORAGE_REQUIREMENTS, slugLabel } from "../vocabulary";
import { UNITS } from "../core/units";

const CUSTOM_KIND = "__custom__";
const NO_STORAGE = "__none__";
const NOT_CHOSEN = "";

/**
 * Add an item.
 *
 * THE STOCKING UNIT IS THE CONSEQUENTIAL FIELD, and the copy says so. Every
 * balance for this item is denominated in it forever — changing it later is
 * refused once anything has moved, because converting the column alone would
 * silently restate the whole ledger.
 *
 * Nothing is pre-selected. `land` shipped a picker that defaulted to the
 * alphabetically-first option and quietly recorded good pasture as a house
 * site; the lesson generalises to any dialog that asks a question.
 */
export function ItemForm({
  kindsInUse,
  livestockEnabled = false,
}: {
  kindsInUse: string[];
  /** Only redirect somewhere this tenant actually has. */
  livestockEnabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const kindOptions = [
    ...SUGGESTED_ITEM_KINDS,
    ...[...new Set(kindsInUse)]
      .filter((k) => !SUGGESTED_ITEM_KINDS.includes(k as never))
      .sort(),
  ];

  const [kindChoice, setKindChoice] = useState<string>(NOT_CHOSEN);
  const [customKind, setCustomKind] = useState("");
  const [unit, setUnit] = useState<string>(NOT_CHOSEN);

  const kind = kindChoice === CUSTOM_KIND ? customKind.trim() : kindChoice;
  /**
   * **ANIMALS ARE NOT STARTED HERE, AND THE FORM HAS TO SAY SO.**
   *
   * Picking "Livestock" and pressing on produces an item with no batch and no
   * biology — a half-thing that appears in the Livestock form's "Counted as"
   * picker and nowhere else, looking like something went wrong. Nothing stopped
   * it and nothing warned about it, and the founder asked which page he was
   * supposed to use.
   *
   * `Start a lot` on the Livestock page makes all three in one transaction, so
   * this sends people there rather than letting them build the broken half.
   */
  const redirectToLivestock = livestockEnabled && kind === "livestock";
  const canSubmit = Boolean(kind) && Boolean(unit) && !redirectToLivestock;

  function submit(formData: FormData) {
    if (!canSubmit) return;
    const rawQty = String(formData.get("purchaseUnitQty") ?? "").trim();
    const purchaseUnit = String(formData.get("purchaseUnit") ?? "").trim();
    const storage = String(formData.get("storageRequirement") ?? NO_STORAGE);

    startTransition(async () => {
      const result = await createItemAction({
        name: String(formData.get("name") ?? ""),
        itemKind: kind.toLowerCase().replace(/\s+/g, "_"),
        stockingUnit: unit,
        purchaseUnit: purchaseUnit || null,
        purchaseUnitQty: rawQty ? Number(rawQty) : null,
        storageRequirement: storage === NO_STORAGE ? null : storage,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Item added");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add item</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add an item</DialogTitle>
            <DialogDescription>
              Something you hold a quantity of — feed, cartons, ground beef.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required maxLength={200} autoFocus />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="kind">Kind</Label>
                <Select value={kindChoice} onValueChange={setKindChoice}>
                  <SelectTrigger id="kind">
                    <SelectValue placeholder="Pick a kind" />
                  </SelectTrigger>
                  <SelectContent>
                    {kindOptions.map((k) => (
                      <SelectItem key={k} value={k}>
                        {slugLabel(k)}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_KIND}>Something else…</SelectItem>
                  </SelectContent>
                </Select>
                {kindChoice === CUSTOM_KIND && (
                  <Input
                    aria-label="New kind"
                    placeholder="e.g. bedding"
                    value={customKind}
                    onChange={(e) => setCustomKind(e.target.value)}
                    maxLength={63}
                  />
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="stockingUnit">Counted in</Label>
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger id="stockingUnit">
                    <SelectValue placeholder="Pick a unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u.code} value={u.code}>
                        {u.plural}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="-mt-2 text-xs text-muted-foreground">
              {/* The one rule the whole pack rests on, in the place somebody
                  is about to commit to it. The meat sentence is here rather
                  than in a hint that appears AFTER picking, because it is
                  meant to decide the choice and not to explain it. */}
              Every balance for this item is kept in that unit, and it cannot be
              changed once anything has moved. Buy feed in bags, count it in
              pounds. Count meat in packages — a package is what gets loaded
              onto a truck and handed over.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="purchaseUnit">Bought in</Label>
                <Input
                  id="purchaseUnit"
                  name="purchaseUnit"
                  maxLength={32}
                  placeholder="e.g. bag"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="purchaseUnitQty">How many, each</Label>
                <Input
                  id="purchaseUnitQty"
                  name="purchaseUnitQty"
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder="e.g. 50"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="storageRequirement">Needs to be kept</Label>
              <Select name="storageRequirement" defaultValue={NO_STORAGE}>
                <SelectTrigger id="storageRequirement">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_STORAGE}>Doesn&apos;t matter</SelectItem>
                  {STORAGE_REQUIREMENTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {slugLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>

          {redirectToLivestock && (

            <div className="rounded-md border border-dashed p-4 text-sm">

              <p className="font-medium">Animals are started in Livestock.</p>

              <p className="mt-1 text-muted-foreground">

                Adding one here would make a stock line with no batch and no

                breed, age or paddock behind it.{" "}

                <Link href="/dashboard/m/livestock" className="underline">

                  Start a lot

                </Link>{" "}

                instead — it creates the stock line, the batch and the animal

                together, and it will let you name a new one as you go.

              </p>

            </div>

          )}


          <DialogFooter>
            <Button type="submit" disabled={pending || !canSubmit}>
              {pending ? "Saving…" : "Add item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------ editing one ---

export interface EditableItem {
  id: string;
  name: string;
  itemKind: string;
  stockingUnit: string;
  purchaseUnit: string | null;
  purchaseUnitQty: number | null;
  storageRequirement: string | null;
  notes: string;
  status: string;
}

/**
 * Edit an item, and retire or restore it.
 *
 * **`updateItem` AND `archiveItem` SHIPPED IN SLICE 0 WITH NO CALLER AT ALL,
 * and the dossier has carried that as an open item ever since** — so an item
 * could not be renamed, re-kinded or retired from any screen in the app. This
 * is the dialog.
 *
 * **THE UNIT IS THE FIELD THIS EXISTS FOR.** `ops.updateItem` refuses to change
 * it once anything has moved, correctly: every movement was recorded in the old
 * unit, so converting the column alone would silently restate the whole ledger.
 * What that refusal implies is that the unit CAN be fixed before then — and
 * until now nothing could. Somebody adding "Ground beef" in pounds when they
 * meant packages had to live with it.
 *
 * **RETIRING IS OUTSIDE THE DIALOG, NOT IN ITS FOOTER**, because a confirm
 * opened from inside an open dialog is two Radix modals deep, and the guard has
 * to be awaited before any transition starts (see `useConfirm`). Side by side,
 * both are one modal, and Save is nowhere near the destructive control.
 */
export function ItemControls({
  item,
  kindsInUse,
  unitLocked,
  onHandLabel,
}: {
  item: EditableItem;
  kindsInUse: string[];
  /** True once ANY movement exists. The unit is then frozen — see above. */
  unitLocked: boolean;
  /**
   * What is on hand, already formatted, or null when nothing has been
   * recorded. Archiving does NOT touch the ledger, so stock behind a retired
   * item stays in every balance and every valuation — the confirm has to say
   * so rather than let somebody find it in a report later.
   */
  onHandLabel: string | null;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const kindOptions = [
    ...SUGGESTED_ITEM_KINDS,
    ...[...new Set([...kindsInUse, item.itemKind])]
      .filter((k) => !SUGGESTED_ITEM_KINDS.includes(k as never))
      .sort(),
  ];

  const [kindChoice, setKindChoice] = useState(item.itemKind);
  const [customKind, setCustomKind] = useState("");
  const [unit, setUnit] = useState(item.stockingUnit);
  const [storage, setStorage] = useState(item.storageRequirement ?? NO_STORAGE);

  const kind = kindChoice === CUSTOM_KIND ? customKind.trim() : kindChoice;
  const archived = item.status === "archived";

  function submit(formData: FormData) {
    if (!kind || !unit) return;
    const rawQty = String(formData.get("purchaseUnitQty") ?? "").trim();
    const purchaseUnit = String(formData.get("purchaseUnit") ?? "").trim();

    startTransition(async () => {
      const result = await updateItemAction({
        id: item.id,
        name: String(formData.get("name") ?? ""),
        itemKind: kind.toLowerCase().replace(/\s+/g, "_"),
        stockingUnit: unit,
        purchaseUnit: purchaseUnit || null,
        purchaseUnitQty: rawQty ? Number(rawQty) : null,
        storageRequirement: storage === NO_STORAGE ? null : storage,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      setOpen(false);
      router.refresh();
    });
  }

  async function retire() {
    // ASKED BEFORE THE TRANSITION STARTS. Awaiting the dialog inside one
    // deadlocks it — see the note in `useConfirm`.
    const asked = await confirm({
      title: `Retire ${item.name}?`,
      description: onHandLabel
        ? `It stops appearing in lists, and nothing else changes: ${onHandLabel} stays on hand, in every balance and every valuation. You can put it back.`
        : "It stops appearing in lists. Nothing in the ledger changes, and you can put it back.",
      confirmLabel: "Retire it",
    });
    if (!asked) return;
    startTransition(async () => {
      const result = await archiveItemAction({ id: item.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Retired");
      router.refresh();
    });
  }

  function restore() {
    startTransition(async () => {
      const result = await restoreItemAction({ id: item.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Back in the list");
      router.refresh();
    });
  }

  return (
    <>
      {confirmDialog}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <form action={submit}>
            <DialogHeader>
              <DialogTitle>Edit {item.name}</DialogTitle>
              <DialogDescription>
                What this item is and how it is bought. What it is COUNTED in is
                a different matter — see below.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={item.name}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-kind">Kind</Label>
                  <Select value={kindChoice} onValueChange={setKindChoice}>
                    <SelectTrigger id="edit-kind">
                      <SelectValue placeholder="Pick a kind" />
                    </SelectTrigger>
                    <SelectContent>
                      {kindOptions.map((k) => (
                        <SelectItem key={k} value={k}>
                          {slugLabel(k)}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_KIND}>Something else…</SelectItem>
                    </SelectContent>
                  </Select>
                  {kindChoice === CUSTOM_KIND && (
                    <Input
                      aria-label="New kind"
                      placeholder="e.g. bedding"
                      value={customKind}
                      onChange={(e) => setCustomKind(e.target.value)}
                      maxLength={63}
                    />
                  )}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="edit-unit">Counted in</Label>
                  <Select
                    value={unit}
                    onValueChange={setUnit}
                    disabled={unitLocked}
                  >
                    <SelectTrigger id="edit-unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITS.map((u) => (
                        <SelectItem key={u.code} value={u.code}>
                          {u.plural}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="-mt-2 text-xs text-muted-foreground">
                {unitLocked
                  ? "Locked. Stock has already moved in this unit, and changing the column alone would restate every entry ever recorded against it. Start a new item instead."
                  : "Nothing has moved yet, so this can still be fixed. Count meat in packages — a package is what gets loaded onto a truck and handed over. After the first entry it is fixed for good."}
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-purchaseUnit">Bought in</Label>
                  <Input
                    id="edit-purchaseUnit"
                    name="purchaseUnit"
                    maxLength={32}
                    placeholder="e.g. bag"
                    defaultValue={item.purchaseUnit ?? ""}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-purchaseUnitQty">How many, each</Label>
                  <Input
                    id="edit-purchaseUnitQty"
                    name="purchaseUnitQty"
                    type="number"
                    min="0"
                    step="0.0001"
                    placeholder="e.g. 50"
                    defaultValue={item.purchaseUnitQty ?? ""}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-storage">Needs to be kept</Label>
                <Select value={storage} onValueChange={setStorage}>
                  <SelectTrigger id="edit-storage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_STORAGE}>Doesn&apos;t matter</SelectItem>
                    {STORAGE_REQUIREMENTS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {slugLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  name="notes"
                  rows={2}
                  maxLength={5000}
                  defaultValue={item.notes}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={pending || !kind || !unit}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {archived ? (
        <Button variant="outline" onClick={restore} disabled={pending}>
          Put back
        </Button>
      ) : (
        <Button variant="ghost" onClick={retire} disabled={pending}>
          Retire
        </Button>
      )}
    </>
  );
}
