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
import { startZoneUseAction } from "../actions";
import {
  SUGGESTED_ZONE_USES,
  defaultProductive,
  zoneUseLabel,
} from "../vocabulary";

/** One declared use, as both callers already hold it. */
export interface ZoneUseRow {
  id: string;
  use: string;
  isProductive: boolean;
  startedOn: string;
  endedOn: string | null;
}

const CUSTOM_USE = "__custom__";
const NO_USE = "";

/**
 * Saying what a piece of ground is for, from a date.
 *
 * **IT WAS ONLY EVER IN THE ROW MENU, TWO SCREENS FROM THE GROUND ITSELF.**
 * `Set what it is for` lived in the paddock table's per-row dropdown on the
 * PARCEL's page, and the zone's own page — the one `Which paddock am I in?`
 * lands on — showed the last five uses with no way to add one. Standing in a
 * field and deciding this is hay now meant going back up to the parcel, finding
 * the row and opening its menu.
 *
 * Extracted rather than copied: the picker's ORDER carries a bug fix from
 * 2026-08-15 that a second copy would eventually lose.
 *
 * **OWNER-ONLY, and that is the pack's line rather than this dialog's.** A
 * use is a dated fact about a cost object, which is why `startZoneUse` is
 * `owner` while recording a stay is `member`.
 */
export function ZoneUseForm({
  zoneId,
  zoneName,
  today,
  usesInUse,
  history,
  open: openProp,
  onOpenChange,
  trigger,
}: {
  zoneId: string;
  zoneName: string;
  /** The TENANT's today, never the browser's. */
  today: string;
  /** Uses this business has already invented, for the picker. */
  usesInUse: string[];
  /** What this ground has been for, newest first. */
  history: ZoneUseRow[];
  /** Driven from outside, for a row menu — see `MoveOccupant` for why. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [selfOpen, setSelfOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : selfOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (!controlled) setSelfOpen(next);
  };
  const [pending, startTransition] = useTransition();

  /**
   * NOT SORTED, and that is the fix rather than an oversight.
   * `SUGGESTED_ZONE_USES` is declared productive-uses-first; sorting threw that
   * away and put `building_site` at the top — both the least likely answer for
   * a paddock and a NON-PRODUCTIVE one, so a hurried tap recorded good ground
   * as a house site that earns nothing. Found by using it, 2026-08-15.
   * Tenant-invented uses are appended, sorted among themselves, so the pack's
   * own order stays stable as they accumulate.
   */
  const useOptions = [
    ...SUGGESTED_ZONE_USES.map((u) => u.use),
    ...[...new Set(usesInUse)]
      .filter((u) => !SUGGESTED_ZONE_USES.some((s) => s.use === u))
      .sort(),
  ];

  const current = history.find((h) => h.endedOn === null) ?? null;
  // NO PRESELECTION when the zone has nothing declared yet. The dialog asks a
  // question, and the answer should come from the person rather than from
  // whatever happens to be first in a list. A zone that already has a use
  // pre-selects it, because that one IS the current answer.
  const [useChoice, setUseChoice] = useState(current?.use ?? NO_USE);
  const [customUse, setCustomUse] = useState("");
  const [productive, setProductive] = useState(current?.isProductive ?? true);

  function pickUse(value: string) {
    setUseChoice(value);
    if (value !== CUSTOM_USE) setProductive(defaultProductive(value));
  }

  /** What would actually be recorded. Empty means nothing has been chosen. */
  const chosenUse = useChoice === CUSTOM_USE ? customUse.trim() : useChoice;

  function save(formData: FormData) {
    // The Select is not a native form control, so `required` cannot reach it.
    // The button is disabled too; this is the guard that survives an Enter key.
    if (!chosenUse) return;
    startTransition(async () => {
      const result = await startZoneUseAction({
        zoneId,
        use: chosenUse.toLowerCase().replace(/\s+/g, "_"),
        startedOn: String(formData.get("startedOn") ?? today),
        isProductive: productive,
        notes: String(formData.get("useNotes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Use recorded");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button size="sm" variant="outline">
              Set what it is for
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <form action={save}>
          <DialogHeader>
            <DialogTitle>What is {zoneName} for?</DialogTitle>
            <DialogDescription>
              From a date. Whatever it was for before is closed the day before,
              so the history stays readable.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor={`use-${zoneId}`}>Use</Label>
              <Select value={useChoice} onValueChange={pickUse}>
                <SelectTrigger id={`use-${zoneId}`}>
                  <SelectValue placeholder="Pick a use" />
                </SelectTrigger>
                <SelectContent>
                  {useOptions.map((u) => (
                    <SelectItem key={u} value={u}>
                      {zoneUseLabel(u)}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_USE}>Something else…</SelectItem>
                </SelectContent>
              </Select>
              {useChoice === CUSTOM_USE && (
                <Input
                  aria-label="New use"
                  placeholder="e.g. silvopasture"
                  value={customUse}
                  onChange={(e) => setCustomUse(e.target.value)}
                  maxLength={63}
                  required
                />
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`started-${zoneId}`}>From</Label>
              <Input
                id={`started-${zoneId}`}
                name="startedOn"
                type="date"
                defaultValue={today}
                required
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor={`productive-${zoneId}`}>Expected to earn</Label>
                <p className="text-xs text-muted-foreground">
                  Turn this off for a yard, a lane or a house site. Ground that
                  earns nothing still carries tax and upkeep, and counting it as
                  productive flatters every per-acre figure.
                </p>
              </div>
              <Switch
                id={`productive-${zoneId}`}
                checked={productive}
                onCheckedChange={setProductive}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`use-notes-${zoneId}`}>Notes</Label>
              <Textarea
                id={`use-notes-${zoneId}`}
                name="useNotes"
                rows={2}
                maxLength={5000}
              />
            </div>

            {history.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  History
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {history.map((h) => (
                    <li key={h.id} className="tabular-nums">
                      {h.startedOn} – {h.endedOn ?? "now"} · {zoneUseLabel(h.use)}
                      {!h.isProductive && " (not productive)"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || !chosenUse}>
              {pending ? "Saving…" : "Record use"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
