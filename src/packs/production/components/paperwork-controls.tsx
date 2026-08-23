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
import { setHandleAction } from "../processor-actions";
import {
  readKillSheetAction,
  readPriceListAction,
} from "../paperwork-actions";
import { slugLabel } from "../vocabulary";

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

interface HandleRow {
  keep: boolean;
  kind: string;
  capacityPerDay: string;
  killFee: string;
  cutWrapPerLb: string;
  priceNotes: string;
}

/** Read a processor's price list into its `handles` rows. */
export function ReadPriceListDialog({
  processorId,
  kindOptions,
  word,
}: {
  processorId: string;
  kindOptions: string[];
  word: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<HandleRow[] | null>(null);
  const [note, setNote] = useState("");
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
      setRows(
        proposal.rows.map((row) => ({
          keep: true,
          kind: row.kind,
          capacityPerDay:
            row.capacityPerDay === null ? "" : String(row.capacityPerDay),
          killFee: row.killFee === null ? "" : row.killFee.toFixed(2),
          cutWrapPerLb:
            row.cutWrapPerLb === null ? "" : row.cutWrapPerLb.toFixed(2),
          priceNotes: row.priceNotes,
        })),
      );
      if (proposal.rows.length === 0) {
        toast.error("Nothing could be read off that page.");
      }
    });
  };

  /**
   * **FIVE PRICES, ONE ROW — FOUND BY A REAL RATE SHEET.**
   *
   * `setHandle` upserts on `(processor, kind)`. A real poultry plant's sheet
   * prices chickens, turkeys, ducks, geese and quail separately, and every one
   * of them is `poultry` in this farm's vocabulary — so recording all five
   * wrote five rows into ONE, each silently overwriting the last, and reported
   * "5 recorded". The survivor was whichever happened to be last.
   *
   * The dialog already warned that recording a kind already on file replaces
   * it. It said nothing about rows in the SAME batch colliding with each other,
   * which is the case that actually arises.
   */
  const collidingKinds = (() => {
    const seen = new Set<string>();
    const clashes = new Set<string>();
    for (const row of rows ?? []) {
      if (!row.keep || row.kind === "") continue;
      if (seen.has(row.kind)) clashes.add(row.kind);
      seen.add(row.kind);
    }
    return clashes;
  })();

  const confirm = () => {
    if (!rows) return;
    const keep = rows.filter((r) => r.keep && r.kind !== "");
    if (keep.length === 0) {
      toast.error("Nothing ticked, or nothing has been said what it is for.");
      return;
    }
    if (collidingKinds.size > 0) {
      toast.error(
        `Two ticked rows are both ${[...collidingKinds]
          .map(slugLabel)
          .join(" and ")} — one price per kind, so recording both would keep only the last. Give them different kinds or untick one.`,
      );
      return;
    }
    startTransition(async () => {
      let saved = 0;
      for (const row of keep) {
        const result = await setHandleAction({
          processorId,
          kind: row.kind,
          capacityPerDay:
            row.capacityPerDay === "" ? null : Number(row.capacityPerDay),
          killFee: row.killFee === "" ? null : Number(row.killFee),
          cutWrapPerLb:
            row.cutWrapPerLb === "" ? null : Number(row.cutWrapPerLb),
          priceNotes: row.priceNotes,
        });
        if ("error" in result && result.error) {
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

  const set = (i: number, patch: Partial<HandleRow>) =>
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
        <Button variant="outline" size="sm">
          Read a price list
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
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

          {rows && rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {rows.length} read. Check them against the sheet. There is one
                price per kind, so recording a kind replaces whatever is on file
                for it — and two ticked rows of the same kind would keep only the
                last, which is why a clash is refused.
              </p>
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-end gap-2 rounded-md border p-2"
                >
                  <Switch
                    checked={row.keep}
                    onCheckedChange={(v: boolean) => set(i, { keep: v })}
                    aria-label="Record this row"
                  />
                  <div className="w-36 space-y-1">
                    <Label className="text-xs">
                      What
                      {row.keep && collidingKinds.has(row.kind) && (
                        <span className="ml-1 font-medium text-destructive">
                          · clashes
                        </span>
                      )}
                    </Label>
                    <Select
                      value={row.kind === "" ? "none" : row.kind}
                      onValueChange={(v) =>
                        set(i, { kind: v === "none" ? "" : v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Say what for" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not said</SelectItem>
                        {kindOptions.map((k) => (
                          <SelectItem key={k} value={k}>
                            {slugLabel(k)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-20 space-y-1">
                    <Label className="text-xs">Per day</Label>
                    <Input
                      value={row.capacityPerDay}
                      onChange={(e) =>
                        set(i, { capacityPerDay: e.target.value })
                      }
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs">Kill fee</Label>
                    <Input
                      value={row.killFee}
                      onChange={(e) => set(i, { killFee: e.target.value })}
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs">Cut/lb</Label>
                    <Input
                      value={row.cutWrapPerLb}
                      onChange={(e) => set(i, { cutWrapPerLb: e.target.value })}
                    />
                  </div>
                  <div className="min-w-40 flex-1 space-y-1">
                    <Label className="text-xs">Minimums, extras</Label>
                    <Input
                      value={row.priceNotes}
                      onChange={(e) => set(i, { priceNotes: e.target.value })}
                    />
                  </div>
                </div>
              ))}
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
