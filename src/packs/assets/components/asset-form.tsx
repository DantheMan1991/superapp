"use client";

import { useState, useTransition } from "react";
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
import { createAssetAction } from "../actions";
import { SUGGESTED_ASSET_KINDS, assetKindLabel } from "../vocabulary";

const NO_PARENT = "__none__";
const CUSTOM_KIND = "__custom__";

/**
 * Add an asset.
 *
 * The kind picker offers the suggested list AND a free-text escape, because
 * `assets.kind` is an open taxonomy: the database constrains the format and
 * never the values. A closed dropdown here would quietly turn an open column
 * into a fixed enum — the exact leak the extension model exists to stop, just
 * committed in the UI instead of the schema.
 */
export function AssetForm({
  containers,
  kindsInUse,
}: {
  containers: { id: string; name: string }[];
  kindsInUse: string[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Suggested kinds plus whatever this tenant has actually used, so a farm that
  // invented `chicken_tractor` last week finds it at the top of the list.
  const kindOptions = [
    ...new Set<string>([...SUGGESTED_ASSET_KINDS, ...kindsInUse]),
  ].sort();

  const [kindChoice, setKindChoice] = useState<string>(kindOptions[0] ?? "");
  const [customKind, setCustomKind] = useState("");

  function submit(formData: FormData) {
    const kind =
      kindChoice === CUSTOM_KIND ? customKind : kindChoice;
    const rawCost = String(formData.get("cost") ?? "").trim();
    const parentId = String(formData.get("parentId") ?? NO_PARENT);

    startTransition(async () => {
      const result = await createAssetAction({
        kind: kind.trim().toLowerCase().replace(/\s+/g, "_"),
        name: String(formData.get("name") ?? ""),
        identifier: String(formData.get("identifier") ?? ""),
        acquiredOn: String(formData.get("acquiredOn") ?? ""),
        // Dollars in the field, cents on the wire. Rounding here rather than
        // trusting a float through the action keeps the ledger's integer-cents
        // rule true at the boundary where it is first breakable.
        acquisitionCostCents: rawCost
          ? Math.round(Number(rawCost) * 100)
          : null,
        parentId: parentId === NO_PARENT ? null : parentId,
        notes: String(formData.get("notes") ?? ""),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Asset added");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add asset</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add an asset</DialogTitle>
            <DialogDescription>
              Anything the business owns — a building, a machine, a vehicle, a
              fence.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required maxLength={200} autoFocus />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="kind">Kind</Label>
              <Select value={kindChoice} onValueChange={setKindChoice}>
                <SelectTrigger id="kind">
                  <SelectValue placeholder="Pick a kind" />
                </SelectTrigger>
                <SelectContent>
                  {kindOptions.map((k) => (
                    <SelectItem key={k} value={k}>
                      {assetKindLabel(k)}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_KIND}>Something else…</SelectItem>
                </SelectContent>
              </Select>
              {kindChoice === CUSTOM_KIND && (
                <Input
                  aria-label="New kind"
                  placeholder="e.g. chicken tractor"
                  value={customKind}
                  onChange={(e) => setCustomKind(e.target.value)}
                  maxLength={63}
                  required
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="acquiredOn">Acquired</Label>
                <Input id="acquiredOn" name="acquiredOn" type="date" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cost">Cost</Label>
                <Input
                  id="cost"
                  name="cost"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Leave blank if unknown"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="identifier">Serial or tag</Label>
              <Input id="identifier" name="identifier" maxLength={200} />
            </div>

            {containers.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="parentId">Kept in</Label>
                <Select name="parentId" defaultValue={NO_PARENT}>
                  <SelectTrigger id="parentId">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PARENT}>Nowhere in particular</SelectItem>
                    {containers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add asset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
