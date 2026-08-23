"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import { addRunCarcassAction } from "../actions";
import {
  clearPriceItemsAction,
  setHandleAction,
  setPriceItemAction,
} from "../processor-actions";
import {
  readKillSheetAction,
  readPriceListAction,
} from "../paperwork-actions";
import {
  PRICE_CATEGORIES,
  PRICE_CATEGORY_LABELS,
  PRICE_UNITS,
  PRICE_UNIT_LABELS,
  slugLabel,
} from "../vocabulary";

/**
 * The confirm step, which is the entire safety story of this slice.
 *
 * **NOTHING IS WRITTEN UNTIL SOMEBODY PRESSES THE SECOND BUTTON.** Reading the
 * page produces a table of proposals with every field editable and a tick beside
 * each row. Untick a row and it is not recorded. The confirm then calls the
 * ORDINARY write actions, one per row, so the validation, the refusals and the
 * audit entries are identical to typing it in — there is no privileged path.
 *
 * **EVERY EMPTY FIELD IS THE MODEL DECLINING TO GUESS**, and the copy says so.
 * A farmer who sees a blank hanging weight fills it in; a farmer who sees a
 * confident wrong one does not notice. That is the whole reason the prompts push
 * so hard toward null.
 */

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

/** Strips the `data:...;base64,` prefix a FileReader produces. */
function toBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(toBase64(String(reader.result)));
    reader.onerror = () => reject(new Error("could not read that file"));
    reader.readAsDataURL(file);
  });
}

interface CarcassRow {
  keep: boolean;
  tag: string;
  headCount: string;
  liveLb: string;
  hangingLb: string;
  condemned: boolean;
  condemnReason: string;
}

/**
 * Read a kill sheet onto a run.
 *
 * `runInputId` is REQUIRED and is not something the page can be read for: the
 * sheet says what came off the line, not which pen it came out of, and that link
 * is the one claim the traceability chain exists to make. So the person picks it
 * once, for the whole sheet, before anything is recorded.
 */
export function ReadKillSheetDialog({
  runId,
  inputs,
  sheetWord,
}: {
  runId: string;
  inputs: { id: string; label: string }[];
  sheetWord: string;
}) {
  const [open, setOpen] = useState(false);
  const [inputId, setInputId] = useState(inputs[0]?.id ?? "");
  const [rows, setRows] = useState<CarcassRow[] | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const extract = (file: File) => {
    startTransition(async () => {
      let base64: string;
      try {
        base64 = await readFile(file);
      } catch {
        toast.error("Could not read that file.");
        return;
      }
      const result = await readKillSheetAction({
        runId,
        mimeType: file.type,
        base64,
      });
      // Total rather than clever: a server action's return type widens across
      // the boundary, so this reads the field it needs and falls back to a
      // sentence rather than relying on the union narrowing.
      const proposal = "proposal" in result ? result.proposal : undefined;
      if (!proposal) {
        toast.error(
          "error" in result && result.error
            ? result.error
            : "Nothing could be read off that page.",
        );
        return;
      }
      setNote(proposal.note);
      setRows(
        proposal.lines.map((line) => ({
          keep: true,
          tag: line.tag,
          headCount: String(line.headCount),
          liveLb: line.liveLb === null ? "" : String(line.liveLb),
          hangingLb: line.hangingLb === null ? "" : String(line.hangingLb),
          condemned: line.condemned,
          condemnReason: line.condemnReason,
        })),
      );
      if (proposal.lines.length === 0) {
        toast.error("Nothing could be read off that page.");
      }
    });
  };

  const confirm = () => {
    if (!rows || !inputId) return;
    const keep = rows.filter((r) => r.keep);
    if (keep.length === 0) {
      toast.error("Nothing ticked.");
      return;
    }
    startTransition(async () => {
      let saved = 0;
      for (const row of keep) {
        // The ORDINARY write path, one row at a time. Same validation, same
        // audit entry, same refusals as typing it in.
        const result = await addRunCarcassAction({
          runId,
          runInputId: inputId,
          tag: row.tag,
          headCount: Number(row.headCount) || 1,
          liveLb: row.liveLb === "" ? null : Number(row.liveLb),
          hangingLb:
            row.condemned || row.hangingLb === ""
              ? null
              : Number(row.hangingLb),
          condemned: row.condemned,
          condemnReason: row.condemned ? row.condemnReason : "",
        });
        if ("error" in result && result.error) {
          // Stop at the first refusal rather than pressing on: the rows are a
          // sheet, and half a sheet recorded is worse than none.
          toast.error(`${result.error} (${saved} recorded before this)`);
          router.refresh();
          return;
        }
        saved += 1;
      }
      toast.success(`${saved} recorded`);
      setRows(null);
      setOpen(false);
      router.refresh();
    });
  };

  const set = (i: number, patch: Partial<CarcassRow>) =>
    setRows((prev) =>
      prev ? prev.map((r, j) => (j === i ? { ...r, ...patch } : r)) : prev,
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setRows(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={inputs.length === 0}>
          Read a photo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Read the {sheetWord.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Photograph the page or pick a PDF. Nothing is recorded until you have
            read it back and pressed Record — an empty box means it could not
            read that number and would not guess.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Which of this run&apos;s inputs did these come out of</Label>
            <Select value={inputId} onValueChange={setInputId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {inputs.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The sheet says what came off the line, not which pen it came out
              of. That link is the one claim the chain exists to make, so it is
              yours to set.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="kill-sheet-file">The page</Label>
            <Input
              id="kill-sheet-file"
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) extract(file);
              }}
            />
          </div>

          {note !== "" && (
            <p className="text-sm text-muted-foreground">{note}</p>
          )}

          {rows && rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {rows.length} lines read. Check them against the page.
              </p>
              <div className="space-y-2">
                {rows.map((row, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-end gap-2 rounded-md border p-2"
                  >
                    <Switch
                      checked={row.keep}
                      onCheckedChange={(v: boolean) => set(i, { keep: v })}
                      aria-label="Record this line"
                    />
                    <div className="w-20 space-y-1">
                      <Label className="text-xs">Head</Label>
                      <Input
                        value={row.headCount}
                        onChange={(e) => set(i, { headCount: e.target.value })}
                      />
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-xs">Live</Label>
                      <Input
                        value={row.liveLb}
                        onChange={(e) => set(i, { liveLb: e.target.value })}
                      />
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-xs">Hanging</Label>
                      <Input
                        value={row.hangingLb}
                        disabled={row.condemned}
                        onChange={(e) => set(i, { hangingLb: e.target.value })}
                      />
                    </div>
                    <label className="flex items-center gap-2 pb-2 text-xs">
                      <Switch
                        checked={row.condemned}
                        onCheckedChange={(v: boolean) =>
                          set(i, {
                            condemned: v,
                            // The table's CHECK says a condemned line carries no
                            // hanging weight. Clearing it here means the form
                            // cannot build a row the database will refuse.
                            hangingLb: v ? "" : row.hangingLb,
                          })
                        }
                      />
                      Condemned
                    </label>
                    {row.condemned && (
                      <div className="min-w-40 flex-1 space-y-1">
                        <Label className="text-xs">Cause</Label>
                        <Input
                          value={row.condemnReason}
                          onChange={(e) =>
                            set(i, { condemnReason: e.target.value })
                          }
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={confirm}
            disabled={pending || !rows || rows.length === 0}
          >
            Record these
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ItemRow {
  keep: boolean;
  kind: string;
  category: string;
  label: string;
  price: string;
  unit: string;
  minimum: string;
  notes: string;
}

interface AnimalRow {
  keep: boolean;
  kind: string;
  capacityPerDay: string;
  priceNotes: string;
}

/**
 * Read a processor's price list into priced ITEMS and the animals they take.
 *
 * **TWO LISTS, BECAUSE THEY ARE TWO DIFFERENT FACTS.** A rate sheet says both
 * *we take turkeys* and *quartering a chicken is $1.05*, and until the price
 * items table existed the second had nowhere to go but prose. The first still
 * belongs on the handle row — it is what a plant will take, and it stays true
 * when the prices change.
 *
 * **THE CONFIRM IS STILL THE ENTIRE SAFETY STORY.** Every field is editable,
 * every row has a tick, and Record calls `setPriceItemAction` and
 * `setHandleAction` one row at a time — the ordinary write paths, with the
 * ordinary refusals and the ordinary audit entries.
 */
export function ReadPriceListDialog({
  processorId,
  kindOptions,
  word,
  existingCount,
}: {
  processorId: string;
  kindOptions: string[];
  word: string;
  /** How many prices are already on file, so the replace copy can say so. */
  existingCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [animals, setAnimals] = useState<AnimalRow[] | null>(null);
  const [note, setNote] = useState("");
  /**
   * **REPLACE, BECAUSE A RE-READ OTHERWISE LANDS BESIDE THE OLD LIST.**
   * `setPriceItem` keys on `(processor, kind, label)`, so a read that corrects
   * the ANIMAL does not correct the row — it writes a new one and leaves the
   * old. The live `Test` tenant reached 108 items with 75 mis-filed exactly
   * that way, and reading the sheet again would have made it 183.
   *
   * Defaults ON when there is already a list, because re-reading a sheet is
   * almost always "this is the current one" rather than "add these to what is
   * there". The count is in the copy so the choice is made with the number in
   * front of you.
   */
  const [replace, setReplace] = useState(existingCount > 0);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const extract = (file: File) => {
    startTransition(async () => {
      let base64: string;
      try {
        base64 = await readFile(file);
      } catch {
        toast.error("Could not read that file.");
        return;
      }
      const result = await readPriceListAction({
        processorId,
        mimeType: file.type,
        base64,
      });
      // Total rather than clever: a server action's return type widens across
      // the boundary, so this reads the field it needs and falls back to a
      // sentence rather than relying on the union narrowing.
      const proposal = "proposal" in result ? result.proposal : undefined;
      if (!proposal) {
        toast.error(
          "error" in result && result.error
            ? result.error
            : "Nothing could be read off that page.",
        );
        return;
      }
      setNote(proposal.note);
      setItems(
        proposal.items.map((row) => ({
          keep: true,
          kind: row.kind,
          category: row.category,
          label: row.label,
          price: row.price === null ? "" : row.price.toFixed(2),
          unit: row.unit,
          minimum: row.minimum === null ? "" : row.minimum.toFixed(2),
          notes: row.notes,
        })),
      );
      setAnimals(
        proposal.animals.map((row) => ({
          keep: true,
          kind: row.kind,
          capacityPerDay:
            row.capacityPerDay === null ? "" : String(row.capacityPerDay),
          priceNotes: row.priceNotes,
        })),
      );
      if (proposal.items.length === 0 && proposal.animals.length === 0) {
        toast.error("Nothing could be read off that page.");
      }
    });
  };

  /**
   * **A CLASH IS TWO TICKED ROWS THAT WOULD WRITE INTO ONE**, and refusing it
   * is the fix a real rate sheet forced on 2026-08-23: five poultry rows all
   * mapping to `poultry` were written into a single handle, each overwriting
   * the last, and the dialog reported "5 recorded".
   *
   * The two keys differ because the two unique indexes differ — an item is one
   * price per `(kind, label)`, an animal is one row per `kind` — and that is
   * itself the point of itemising: quartered and eight-piece are now two
   * labels rather than two claims on one column.
   */
  const clashesIn = (keys: (string | null)[]) => {
    const seen = new Set<string>();
    const clashes = new Set<string>();
    for (const key of keys) {
      if (key === null) continue;
      if (seen.has(key)) clashes.add(key);
      seen.add(key);
    }
    return clashes;
  };
  const itemKey = (row: ItemRow) =>
    row.keep && row.label.trim() !== ""
      ? [row.kind, row.label.trim().toLowerCase()].join(" ")
      : null;
  const itemClashes = clashesIn((items ?? []).map(itemKey));
  const animalClashes = clashesIn(
    (animals ?? []).map((r) => (r.keep && r.kind !== "" ? r.kind : null)),
  );

  const confirm = () => {
    const keepItems = (items ?? []).filter(
      (r) => r.keep && r.label.trim() !== "",
    );
    const keepAnimals = (animals ?? []).filter((r) => r.keep && r.kind !== "");
    if (keepItems.length === 0 && keepAnimals.length === 0) {
      toast.error("Nothing ticked, or nothing named.");
      return;
    }
    if (itemClashes.size > 0) {
      toast.error(
        "Two ticked prices have the same name for the same animal — recording both would keep only the last. Give them different names or untick one.",
      );
      return;
    }
    if (animalClashes.size > 0) {
      toast.error(
        `Two ticked animals are both ${[...animalClashes]
          .map(slugLabel)
          .join(" and ")} — one row per kind, so recording both would keep only the last.`,
      );
      return;
    }
    startTransition(async () => {
      let saved = 0;
      const fail = (message: string) => {
        toast.error(`${message} (${saved} recorded before this)`);
        router.refresh();
      };
      /**
       * CLEARED FIRST, so the rows that follow are the whole list rather than
       * an addition to one. Not in the same transaction as the writes — each
       * row still goes through `setPriceItemAction` one at a time, which is the
       * rule this path exists under — so a refusal halfway leaves the list
       * short rather than doubled. Short and visible beats doubled and
       * plausible.
       */
      if (replace) {
        const cleared = await clearPriceItemsAction({ processorId });
        if ("error" in cleared && cleared.error) {
          toast.error(cleared.error);
          return;
        }
      }
      for (const row of keepAnimals) {
        const result = await setHandleAction({
          processorId,
          kind: row.kind,
          capacityPerDay:
            row.capacityPerDay === "" ? null : Number(row.capacityPerDay),
          priceNotes: row.priceNotes,
        });
        // Stop at the first refusal rather than pressing on: the rows come off
        // one page, and a half-recorded page is worse than an unrecorded one
        // because nothing on the screen says which half.
        if ("error" in result && result.error) return fail(result.error);
        saved += 1;
      }
      for (const row of keepItems) {
        const result = await setPriceItemAction({
          processorId,
          kind: row.kind,
          category: row.category,
          label: row.label,
          price: row.price === "" ? null : Number(row.price),
          unit: row.unit,
          minimum: row.minimum === "" ? null : Number(row.minimum),
          notes: row.notes,
        });
        if ("error" in result && result.error) return fail(result.error);
        saved += 1;
      }
      toast.success(`${saved} recorded`);
      setItems(null);
      setAnimals(null);
      setOpen(false);
      router.refresh();
    });
  };

  const setItem = (i: number, patch: Partial<ItemRow>) =>
    setItems((prev) =>
      prev ? prev.map((r, j) => (j === i ? { ...r, ...patch } : r)) : prev,
    );
  const setAnimal = (i: number, patch: Partial<AnimalRow>) =>
    setAnimals((prev) =>
      prev ? prev.map((r, j) => (j === i ? { ...r, ...patch } : r)) : prev,
    );

  const kindSelect = (value: string, onChange: (next: string) => void) => (
    <Select
      value={value === "" ? "none" : value}
      onValueChange={(v) => onChange(v === "none" ? "" : v)}
    >
      <SelectTrigger>
        <SelectValue placeholder="Say what for" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Anything</SelectItem>
        {kindOptions.map((k) => (
          <SelectItem key={k} value={k}>
            {slugLabel(k)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const anything = (items?.length ?? 0) + (animals?.length ?? 0) > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setItems(null);
          setAnimals(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Read a price list
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Read this {word.toLowerCase()}&apos;s prices</DialogTitle>
          <DialogDescription>
            Photograph the rate sheet or pick a PDF. Nothing changes until you
            have read it back and pressed Record — these are the terms of an
            agreement, so an empty box means it would not guess.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="price-list-file">The page</Label>
            <Input
              id="price-list-file"
              type="file"
              accept={ACCEPT}
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) extract(file);
              }}
            />
          </div>

          {note !== "" && (
            <p className="text-sm text-muted-foreground">{note}</p>
          )}

          {existingCount > 0 && (
            <div className="flex items-start gap-3 rounded-md border p-3">
              <Switch
                checked={replace}
                onCheckedChange={(v: boolean) => setReplace(v)}
                aria-label="Replace the whole price list"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Replace the {existingCount} already on file
                </p>
                <p className="text-xs text-muted-foreground">
                  A rate sheet is the whole list, so this is usually what you
                  want. Left off, anything this page names differently from what
                  is on file is added beside it rather than instead of it.
                </p>
              </div>
            </div>
          )}

          {items && items.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {items.length} priced. Check them against the sheet — above all
                the unit, because the same figure means different money per head
                and per pound. Recording a name already on file for that animal
                replaces it.
              </p>
              {items.map((row, i) => {
                const key = itemKey(row);
                return (
                  <div
                    key={i}
                    className="flex flex-wrap items-end gap-2 rounded-md border p-2"
                  >
                    <Switch
                      checked={row.keep}
                      onCheckedChange={(v: boolean) => setItem(i, { keep: v })}
                      aria-label="Record this price"
                    />
                    <div className="min-w-44 flex-1 space-y-1">
                      <Label className="text-xs">
                        What they charge for
                        {key !== null && itemClashes.has(key) && (
                          <span className="ml-1 font-medium text-destructive">
                            · clashes
                          </span>
                        )}
                      </Label>
                      <Input
                        value={row.label}
                        onChange={(e) => setItem(i, { label: e.target.value })}
                      />
                    </div>
                    <div className="w-32 space-y-1">
                      <Label className="text-xs">For</Label>
                      {kindSelect(row.kind, (kind) => setItem(i, { kind }))}
                    </div>
                    <div className="w-32 space-y-1">
                      <Label className="text-xs">Group</Label>
                      <Select
                        value={row.category}
                        onValueChange={(v) => setItem(i, { category: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRICE_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {PRICE_CATEGORY_LABELS[c]}
                            </SelectItem>
                          ))}
                          {!(PRICE_CATEGORIES as readonly string[]).includes(
                            row.category,
                          ) && (
                            <SelectItem value={row.category}>
                              {slugLabel(row.category)}
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-xs">Price</Label>
                      <Input
                        value={row.price}
                        onChange={(e) => setItem(i, { price: e.target.value })}
                      />
                    </div>
                    <div className="w-36 space-y-1">
                      <Label className="text-xs">Per</Label>
                      <Select
                        value={row.unit}
                        onValueChange={(v) => setItem(i, { unit: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRICE_UNITS.map((u) => (
                            <SelectItem key={u} value={u}>
                              {PRICE_UNIT_LABELS[u]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-xs">Minimum</Label>
                      <Input
                        value={row.minimum}
                        onChange={(e) => setItem(i, { minimum: e.target.value })}
                      />
                    </div>
                    <div className="min-w-40 flex-1 space-y-1">
                      <Label className="text-xs">Conditions</Label>
                      <Input
                        value={row.notes}
                        onChange={(e) => setItem(i, { notes: e.target.value })}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {animals && animals.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                What the sheet says they take. No prices here — those are above.
                There is one row per kind, so recording a kind replaces whatever
                is on file for it.
              </p>
              {animals.map((row, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-end gap-2 rounded-md border p-2"
                >
                  <Switch
                    checked={row.keep}
                    onCheckedChange={(v: boolean) => setAnimal(i, { keep: v })}
                    aria-label="Record this animal"
                  />
                  <div className="w-36 space-y-1">
                    <Label className="text-xs">
                      What
                      {row.keep && animalClashes.has(row.kind) && (
                        <span className="ml-1 font-medium text-destructive">
                          · clashes
                        </span>
                      )}
                    </Label>
                    {kindSelect(row.kind, (kind) => setAnimal(i, { kind }))}
                  </div>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs">Per day</Label>
                    <Input
                      value={row.capacityPerDay}
                      onChange={(e) =>
                        setAnimal(i, { capacityPerDay: e.target.value })
                      }
                    />
                  </div>
                  <div className="min-w-40 flex-1 space-y-1">
                    <Label className="text-xs">
                      Anything that is not a price
                    </Label>
                    <Input
                      value={row.priceNotes}
                      onChange={(e) =>
                        setAnimal(i, { priceNotes: e.target.value })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={confirm} disabled={pending || !anything}>
            Record these
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
