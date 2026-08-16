"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { createItemAction } from "../actions";
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
export function ItemForm({ kindsInUse }: { kindsInUse: string[] }) {
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
  const canSubmit = Boolean(kind) && Boolean(unit);

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
                  is about to commit to it. */}
              Every balance for this item is kept in that unit. Buy feed in
              bags, count it in pounds — it cannot be changed once anything has
              moved.
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
