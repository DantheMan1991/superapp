"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { disposeAssetAction, updateAssetAction } from "../actions";
import { SUGGESTED_ASSET_KINDS, assetKindLabel } from "../vocabulary";

const NO_PARENT = "__none__";
const CUSTOM_KIND = "__custom__";
const NO_ACCOUNT = "__none__";

export interface AssetDetailView {
  id: string;
  name: string;
  kind: string;
  identifier: string;
  model: string;
  status: string;
  acquiredOn: string | null;
  /** Dollars as a string for the number input; null when unknown. */
  costInput: string;
  parentId: string | null;
  notes: string;
  assetAccountId: string | null;
  /** A place things are kept — inventory's location picker reads it. */
  isStorageLocation: boolean;
  /** Pre-formatted on the server; this component never formats money. */
  accumulatedLabel: string;
  bookValueLabel: string;
  /** Null when the books cannot be settled, with the reason. */
  cannotSettle: "no_cost" | "no_asset_account" | null;
}

/**
 * Edit and dispose, the two things the list view could not do.
 *
 * Both live behind dialogs rather than inline fields because every write here
 * is owner-gated and audited — a surface that saves as you type would make an
 * audit trail of keystrokes.
 */
export function AssetControls({
  asset,
  containers,
  kindsInUse,
  assetAccounts,
  proceedsAccounts,
  today,
}: {
  asset: AssetDetailView;
  containers: { id: string; name: string }[];
  kindsInUse: string[];
  /** Fixed-asset accounts — where an asset's cost sits. */
  assetAccounts: { id: string; label: string }[];
  /** Where sale proceeds could land: bank, cash, receivable. */
  proceedsAccounts: { id: string; label: string }[];
  /** The tenant's today, resolved on the server — never the browser's. */
  today: string;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const kindOptions = [
    ...new Set<string>([...SUGGESTED_ASSET_KINDS, ...kindsInUse, asset.kind]),
  ].sort();

  const [kindChoice, setKindChoice] = useState(asset.kind);
  const [customKind, setCustomKind] = useState("");
  const [parentChoice, setParentChoice] = useState(asset.parentId ?? NO_PARENT);
  const [accountChoice, setAccountChoice] = useState(
    asset.assetAccountId ?? NO_ACCOUNT,
  );
  const [proceedsAccount, setProceedsAccount] = useState(NO_ACCOUNT);
  const [isStorageLocation, setIsStorageLocation] = useState(
    asset.isStorageLocation,
  );

  function save(formData: FormData) {
    const kind = kindChoice === CUSTOM_KIND ? customKind : kindChoice;
    const rawCost = String(formData.get("cost") ?? "").trim();
    startTransition(async () => {
      const result = await updateAssetAction({
        id: asset.id,
        kind: kind.trim().toLowerCase().replace(/\s+/g, "_"),
        name: String(formData.get("name") ?? ""),
        identifier: String(formData.get("identifier") ?? ""),
        model: String(formData.get("model") ?? ""),
        acquiredOn: String(formData.get("acquiredOn") ?? ""),
        acquisitionCostCents: rawCost ? Math.round(Number(rawCost) * 100) : null,
        parentId: parentChoice === NO_PARENT ? null : parentChoice,
        notes: String(formData.get("notes") ?? ""),
        assetAccountId: accountChoice === NO_ACCOUNT ? null : accountChoice,
        isStorageLocation,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      setEditOpen(false);
      router.refresh();
    });
  }

  function dispose(formData: FormData) {
    startTransition(async () => {
      const raw = String(formData.get("proceeds") ?? "").trim();
      const proceedsCents = raw ? Math.round(Number(raw) * 100) : 0;
      const result = await disposeAssetAction({
        id: asset.id,
        disposedOn: String(formData.get("disposedOn") ?? ""),
        proceedsCents,
        proceedsAccountId:
          proceedsCents > 0 && proceedsAccount !== NO_ACCOUNT
            ? proceedsAccount
            : null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.posted
          ? "Disposed, and the books are settled"
          : "Marked as disposed — nothing posted, see the note",
      );
      setDisposeOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">Edit</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <form action={save}>
            <DialogHeader>
              <DialogTitle>Edit asset</DialogTitle>
              <DialogDescription>
                Changing the name also renames it wherever it is reported on.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={asset.name}
                  required
                  maxLength={200}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="kind">Kind</Label>
                <Select value={kindChoice} onValueChange={setKindChoice}>
                  <SelectTrigger id="kind">
                    <SelectValue />
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
                  <Input
                    id="acquiredOn"
                    name="acquiredOn"
                    type="date"
                    defaultValue={asset.acquiredOn ?? ""}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cost">Cost</Label>
                  <Input
                    id="cost"
                    name="cost"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={asset.costInput}
                    placeholder="Leave blank if unknown"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="model">Model</Label>
                  <Input
                    id="model"
                    name="model"
                    defaultValue={asset.model}
                    maxLength={200}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="identifier">Serial or tag</Label>
                  <Input
                    id="identifier"
                    name="identifier"
                    defaultValue={asset.identifier}
                    maxLength={200}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="parentId">Kept in</Label>
                <Select value={parentChoice} onValueChange={setParentChoice}>
                  <SelectTrigger id="parentId">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PARENT}>
                      Nowhere in particular
                    </SelectItem>
                    {/* This asset and everything inside it are already absent
                        from `containers` — the server excludes the subtree, so
                        a cycle is not offerable rather than merely refused. */}
                    {containers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="assetAccountId">Cost sits in</Label>
                <Select value={accountChoice} onValueChange={setAccountChoice}>
                  <SelectTrigger id="assetAccountId">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ACCOUNT}>Not on the books</SelectItem>
                    {assetAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Where this asset&rsquo;s cost was booked when you bought it.
                  Yosher does not post it again — it needs to know where it
                  already sits so a disposal can take it back off.
                </p>
              </div>

              <div className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="isStorageLocation">Things are kept here</Label>
                  <p className="text-muted-foreground text-xs">
                    A freezer, a barn, a garage. Turn this on and it can be
                    picked as a place stock is held.
                  </p>
                </div>
                <Switch
                  id="isStorageLocation"
                  checked={isStorageLocation}
                  onCheckedChange={setIsStorageLocation}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  defaultValue={asset.notes}
                  rows={3}
                  maxLength={5000}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {asset.status === "active" && (
        <Dialog open={disposeOpen} onOpenChange={setDisposeOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">Dispose</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <form action={dispose}>
              <DialogHeader>
                <DialogTitle>Dispose of {asset.name}?</DialogTitle>
                <DialogDescription>
                  {asset.cannotSettle
                    ? "The asset stays on record with its history. Nothing will be posted — see below."
                    : `Its cost and ${asset.accumulatedLabel} of depreciation come off the balance sheet, and the difference against ${asset.bookValueLabel} book value is recorded as a gain or loss.`}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="disposedOn">Date of disposal</Label>
                  <Input
                    id="disposedOn"
                    name="disposedOn"
                    type="date"
                    defaultValue={today}
                    required
                  />
                </div>

                {!asset.cannotSettle && (
                  <>
                    <div className="grid gap-2">
                      <Label htmlFor="proceeds">Sold for</Label>
                      <Input
                        id="proceeds"
                        name="proceeds"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00 if scrapped or given away"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="proceedsAccount">Money went into</Label>
                      <Select
                        value={proceedsAccount}
                        onValueChange={setProceedsAccount}
                      >
                        <SelectTrigger id="proceedsAccount">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ACCOUNT}>
                            Nothing received
                          </SelectItem>
                          {proceedsAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                {asset.cannotSettle && (
                  // Said plainly rather than failing quietly. An asset whose
                  // cost is on no account has nothing to remove, and guessing
                  // an account would put a real number in the wrong place.
                  <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                    {asset.cannotSettle === "no_cost"
                      ? "This asset has no recorded cost, so there is nothing to take off the balance sheet. Add a cost first if you want the disposal to post."
                      : "This asset's cost is not linked to an account, so Yosher does not know what to remove. Set “Cost sits in” under Edit first if you want the disposal to post."}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Mark as disposed"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
