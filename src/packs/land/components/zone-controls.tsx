"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  retireZoneAction,
  startZoneUseAction,
  updateZoneAction,
} from "../actions";
import {
  SUGGESTED_ZONE_USES,
  defaultProductive,
  zoneUseLabel,
} from "../vocabulary";
import { AREA_UNIT_LABELS, toAcres, type AreaUnit } from "../core/area";

const CUSTOM_USE = "__custom__";
/** Nothing picked yet. The Select shows its placeholder and submit is refused. */
const NO_USE = "";

export interface ZoneUseRow {
  id: string;
  use: string;
  isProductive: boolean;
  startedOn: string;
  endedOn: string | null;
}

export interface ZoneRowView {
  id: string;
  name: string;
  /** Already converted into the tenant's unit, as a plain input value. */
  areaInput: string;
  notes: string;
  history: ZoneUseRow[];
}

/**
 * Per-zone actions: set what it is for, edit it, retire it.
 *
 * The use picker offers the suggested list AND a free-text escape, because
 * `land_zone_uses.use` is an open taxonomy — the database constrains the
 * format and never the values. A closed dropdown would quietly turn an open
 * column into a fixed enum in the UI instead of the schema.
 *
 * "Productive" is a switch rather than a derived value. The pack proposes a
 * default for uses it knows and the tenant can disagree, because the taxonomy
 * is open and the pack genuinely cannot know whether a use it has never heard
 * of earns anything.
 */
export function ZoneControls({
  zone,
  unit,
  zoneWord,
  today,
  usesInUse,
}: {
  zone: ZoneRowView;
  unit: AreaUnit;
  zoneWord: string;
  /** The TENANT's today, never the browser's. */
  today: string;
  /** Uses this tenant has already used, so its own vocabulary comes first. */
  usesInUse: string[];
}) {
  const router = useRouter();
  const [settingUse, setSettingUse] = useState(false);
  const [editing, setEditing] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [pending, startTransition] = useTransition();

  // NOT SORTED, and that is the fix rather than an oversight.
  // `SUGGESTED_ZONE_USES` is declared productive-uses-first; sorting threw that
  // away and put `building_site` at the top — both the least likely answer for
  // a paddock and a NON-PRODUCTIVE one, so a hurried tap recorded good ground
  // as a house site that earns nothing. Found by using it, 2026-08-15.
  // Tenant-invented uses are appended, sorted among themselves, so the pack's
  // own order stays stable as they accumulate.
  const useOptions = [
    ...SUGGESTED_ZONE_USES.map((u) => u.use),
    ...[...new Set(usesInUse)]
      .filter((u) => !SUGGESTED_ZONE_USES.some((s) => s.use === u))
      .sort(),
  ];

  const current = zone.history.find((h) => h.endedOn === null) ?? null;
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

  function saveUse(formData: FormData) {
    // The Select is not a native form control, so `required` cannot reach it.
    // The button is disabled too; this is the guard that survives an Enter key.
    if (!chosenUse) return;
    startTransition(async () => {
      const result = await startZoneUseAction({
        zoneId: zone.id,
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
      setSettingUse(false);
      router.refresh();
    });
  }

  function saveEdit(formData: FormData) {
    const rawArea = String(formData.get("area") ?? "").trim();
    startTransition(async () => {
      const result = await updateZoneAction({
        id: zone.id,
        name: String(formData.get("name") ?? ""),
        areaAcres: rawArea ? toAcres(Number(rawArea), unit) : null,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${zoneWord} updated`);
      setEditing(false);
      router.refresh();
    });
  }

  function retire() {
    startTransition(async () => {
      const result = await retireZoneAction({ id: zone.id, endedOn: today });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${zoneWord} retired`);
      setRetiring(false);
      router.refresh();
    });
  }

  const word = zoneWord.toLowerCase();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${zone.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setSettingUse(true)}>
            Set what it is for
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            Edit {word}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRetiring(true)}>
            Retire {word}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={settingUse} onOpenChange={setSettingUse}>
        <DialogContent className="sm:max-w-md">
          <form action={saveUse}>
            <DialogHeader>
              <DialogTitle>What is {zone.name} for?</DialogTitle>
              <DialogDescription>
                From a date. Whatever it was for before is closed the day
                before, so the history stays readable.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor={`use-${zone.id}`}>Use</Label>
                <Select value={useChoice} onValueChange={pickUse}>
                  <SelectTrigger id={`use-${zone.id}`}>
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
                <Label htmlFor={`started-${zone.id}`}>From</Label>
                <Input
                  id={`started-${zone.id}`}
                  name="startedOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>

              <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor={`productive-${zone.id}`}>
                    Expected to earn
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Turn this off for a yard, a lane or a house site. Ground
                    that earns nothing still carries tax and upkeep, and
                    counting it as productive flatters every per-acre figure.
                  </p>
                </div>
                <Switch
                  id={`productive-${zone.id}`}
                  checked={productive}
                  onCheckedChange={setProductive}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`use-notes-${zone.id}`}>Notes</Label>
                <Textarea
                  id={`use-notes-${zone.id}`}
                  name="useNotes"
                  rows={2}
                  maxLength={5000}
                />
              </div>

              {zone.history.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    History
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {zone.history.map((h) => (
                      <li key={h.id} className="tabular-nums">
                        {h.startedOn} – {h.endedOn ?? "now"} ·{" "}
                        {zoneUseLabel(h.use)}
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

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <form action={saveEdit}>
            <DialogHeader>
              <DialogTitle>Edit {zone.name}</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor={`name-${zone.id}`}>Name</Label>
                <Input
                  id={`name-${zone.id}`}
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={zone.name}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`area-${zone.id}`}>
                  Area in {AREA_UNIT_LABELS[unit].many}
                </Label>
                <Input
                  id={`area-${zone.id}`}
                  name="area"
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder="Leave blank if unknown"
                  defaultValue={zone.areaInput}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`notes-${zone.id}`}>Notes</Label>
                <Textarea
                  id={`notes-${zone.id}`}
                  name="notes"
                  rows={2}
                  maxLength={5000}
                  defaultValue={zone.notes}
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

      <Dialog open={retiring} onOpenChange={setRetiring}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Retire {zone.name}?</DialogTitle>
            <DialogDescription>
              Its history stays, and so does every cost recorded against it. It
              stops being offered anywhere new, and whatever it is currently for
              is closed today.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetiring(false)}>
              Cancel
            </Button>
            <Button onClick={retire} disabled={pending}>
              {pending ? "Retiring…" : `Retire ${word}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
