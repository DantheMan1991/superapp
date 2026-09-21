"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/app/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AssemblyLineShape } from "@/db/schema";
import { formatMoney, parseMoneyToCents } from "@/lib/money";
import { quantityStringToThousandths } from "../billing-math";
import type { EditableLine } from "../assembly-math";
import { updateAssemblyAction } from "../assembly-actions";

const BLANK: EditableLine = {
  description: "",
  clientDescription: "",
  clientVisible: true,
  unit: "",
  quantity: "1",
  unitCost: "0.00",
  costCode: "",
  markupPpm: null,
  unitPriceCents: null,
};

/**
 * ONE ASSEMBLY, OPEN (X10).
 *
 * The screen the library never had. The founder's question was *"how do we
 * control what sub members get put on an item. When to include equipment
 * hours, when to include labor materials etc"* — and this is where that is
 * answered once, in his words, rather than guessed at per bid.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 *
 * No margin column. An assembly's lines carry cost, and `markupPpm` /
 * `unitPriceCents` come with them when one is saved FROM an estimate item
 * that had them — but typing a price here would be a second place to set
 * money on a line, and the estimate is the first. What this edits is the
 * SHAPE: which lines, in which words, at what cost.
 */
export function AssemblyEditor({
  id,
  version,
  initialName,
  initialClientNote,
  initialNotes,
  initialPer,
  initialUnit,
  initialLineShape,
  initialLines,
  canWrite,
  symbol,
}: {
  id: string;
  version: number;
  initialName: string;
  initialClientNote: string;
  initialNotes: string;
  initialPer: string;
  initialUnit: string;
  initialLineShape: AssemblyLineShape;
  initialLines: EditableLine[];
  canWrite: boolean;
  symbol: string | null;
}) {
  const router = useRouter();
  const [at, setAt] = useState(version);
  const [name, setName] = useState(initialName);
  const [clientNote, setClientNote] = useState(initialClientNote);
  const [notes, setNotes] = useState(initialNotes);
  const [per, setPer] = useState(initialPer);
  const [unit, setUnit] = useState(initialUnit);
  const [lineShape, setLineShape] = useState<AssemblyLineShape>(initialLineShape);
  const [lines, setLines] = useState<EditableLine[]>(
    initialLines.length > 0 ? initialLines : [BLANK],
  );
  const [pending, startTransition] = useTransition();

  function edit(i: number, patch: Partial<EditableLine>) {
    setLines((was) => was.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  }

  /** What one of it costs at the size it is saved at — the figure the picker shows. */
  const cost = lines.reduce((n, l) => {
    const q = quantityStringToThousandths(l.quantity) ?? 0;
    const c = parseMoneyToCents(l.unitCost) ?? 0;
    return n + Math.round((q * c) / 1000);
  }, 0);

  function save() {
    const real = lines.filter((l) => l.description.trim() !== "");
    if (real.length === 0) {
      toast.error("An assembly with no lines is not one. Give at least one a description.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await updateAssemblyAction({
          id,
          version: at,
          name,
          clientNote,
          notes,
          drivingQuantity: per,
          drivingUnit: unit,
          lineShape,
          lines: real.map((l) => ({
            description: l.description,
            clientDescription: l.clientDescription,
            clientVisible: l.clientVisible,
            unit: l.unit,
            quantityThousandths: quantityStringToThousandths(l.quantity) ?? 0,
            unitCostCents: parseMoneyToCents(l.unitCost) ?? 0,
            markupPpm: l.markupPpm ?? 0,
            unitPriceCents: l.unitPriceCents ?? 0,
            costCode: l.costCode,
          })),
        });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        /** The new version, so a second save does not read as somebody else's. */
        setAt(result.version);
        toast.success("Saved");
        router.refresh();
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <Label htmlFor="name" className="text-xs">
              What you call it
            </Label>
            <Input
              id="name"
              className="mt-1"
              value={name}
              maxLength={200}
              disabled={!canWrite}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="per" className="text-xs">
              Priced per
            </Label>
            <Input
              id="per"
              className="mt-1"
              value={per}
              maxLength={40}
              disabled={!canWrite}
              onChange={(e) => setPer(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="unit" className="text-xs">
              of
            </Label>
            <Input
              id="unit"
              className="mt-1"
              value={unit}
              maxLength={24}
              placeholder="lf"
              disabled={!canWrite}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="client-note" className="text-xs">
              The sentence the client reads
            </Label>
            <Input
              id="client-note"
              className="mt-1"
              value={clientNote}
              maxLength={500}
              disabled={!canWrite}
              placeholder="Optional. Carried onto the item this makes."
              onChange={(e) => setClientNote(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="notes" className="text-xs">
              Your own note — never printed
            </Label>
            <Input
              id="notes"
              className="mt-1"
              value={notes}
              maxLength={2000}
              disabled={!canWrite}
              placeholder="What is in it, what it assumes."
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Everything scales off that size. The lines below are what{" "}
          <span className="font-medium">
            {per} {unit}
          </span>{" "}
          of it takes, and dropping it onto a bid at a different quantity scales them all.
        </p>

        {/*
          HOW IT GOES ON THE SHEET (X11) — the founder's own rule, recorded
          rather than re-decided: one item for LVP listing every room, a line
          each for the showers. It is a property of the ITEM, so this is
          where it is set, once.
        */}
        <div className="mt-4 border-t pt-4 sm:max-w-md">
          <Label htmlFor="line-shape" className="text-xs">
            When it covers several rooms
          </Label>
          <Select
            value={lineShape}
            onValueChange={(v) => setLineShape(v as AssemblyLineShape)}
            disabled={!canWrite}
          >
            <SelectTrigger className="mt-1 w-full" id="line-shape">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="one_line">One line, naming the rooms</SelectItem>
              <SelectItem value="per_room">A line for each room</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {lineShape === "per_room"
              ? "A walk that finds this in four rooms writes four lines, each named after its room and sized by that room's floor area when this is priced by area."
              : "A walk that finds this in four rooms writes one line naming all four. Restructure any bid by hand afterwards — this only decides where the walk starts."}
          </p>
        </div>
      </Panel>

      <Panel className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">
            What is in it{" "}
            <span className="font-normal text-muted-foreground">
              — {lines.length} {lines.length === 1 ? "line" : "lines"}
            </span>
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">cost of one</span>{" "}
            <span className="font-medium">{formatMoney(cost, symbol)}</span>
          </p>
        </div>

        <ul className="mt-3 divide-y rounded-md border">
          {lines.map((l, i) => (
            <li key={i} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,3fr)_repeat(4,minmax(0,1fr))_auto] sm:items-end">
              <div>
                {i === 0 && <Label className="text-xs">Description</Label>}
                <Input
                  className="mt-1"
                  value={l.description}
                  maxLength={300}
                  disabled={!canWrite}
                  placeholder="Footing concrete"
                  aria-label={`Line ${i + 1} description`}
                  onChange={(e) => edit(i, { description: e.target.value })}
                />
              </div>
              <div>
                {i === 0 && <Label className="text-xs">Qty</Label>}
                <Input
                  className="mt-1"
                  value={l.quantity}
                  maxLength={40}
                  disabled={!canWrite}
                  aria-label={`Line ${i + 1} quantity`}
                  onChange={(e) => edit(i, { quantity: e.target.value })}
                />
              </div>
              <div>
                {i === 0 && <Label className="text-xs">Unit</Label>}
                <Input
                  className="mt-1"
                  value={l.unit}
                  maxLength={24}
                  disabled={!canWrite}
                  placeholder="cy"
                  aria-label={`Line ${i + 1} unit`}
                  onChange={(e) => edit(i, { unit: e.target.value })}
                />
              </div>
              <div>
                {i === 0 && <Label className="text-xs">Unit cost</Label>}
                <Input
                  className="mt-1"
                  value={l.unitCost}
                  maxLength={20}
                  disabled={!canWrite}
                  aria-label={`Line ${i + 1} unit cost`}
                  onChange={(e) => edit(i, { unitCost: e.target.value })}
                />
              </div>
              <div>
                {i === 0 && <Label className="text-xs">Cost code</Label>}
                <Input
                  className="mt-1"
                  value={l.costCode}
                  maxLength={60}
                  disabled={!canWrite}
                  aria-label={`Line ${i + 1} cost code`}
                  onChange={(e) => edit(i, { costCode: e.target.value })}
                />
              </div>
              {canWrite && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  disabled={pending}
                  onClick={() => setLines((was) => was.filter((_, k) => k !== i))}
                  aria-label={`Remove line ${i + 1}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
              <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-6">
                <Checkbox
                  checked={!l.clientVisible}
                  disabled={!canWrite}
                  onCheckedChange={(v) => edit(i, { clientVisible: v !== true })}
                />
                Keep this line off the proposal
              </label>
            </li>
          ))}
        </ul>

        {canWrite && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((was) => [...was, { ...BLANK }])}
            >
              <Plus className="mr-1.5 size-4" /> Add a line
            </Button>
            <Button type="button" size="sm" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Saving does not touch any bid this has already made — those lines are that job&apos;s.
            </span>
          </div>
        )}
      </Panel>
    </div>
  );
}
