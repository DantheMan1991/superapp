"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addPlanItemAction,
  deletePlanAction,
  deletePlanItemAction,
  saveTakeoffAction,
} from "../actions";
import {
  driftOf,
  takeoffFor,
  totalsOf,
  type TakeoffFeature,
  type TakeoffTotal,
  type TakeoffUnit,
} from "../core/takeoff";
import { type LengthUnit } from "../core/length";

export interface PlanView {
  id: string;
  name: string;
  takenOffAt: string | null;
  features: TakeoffFeature[];
  items: {
    id: string;
    material: string;
    label: string;
    quantity: number;
    unit: string;
    unitCost: number | null;
    sourceFeatureId: string | null;
  }[];
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * What a plan will take to build.
 *
 * **THE COMPUTED LIST AND THE SAVED ONE ARE SHOWN AS TWO DIFFERENT THINGS**,
 * because they are. The computed one is what the drawing says right now; the
 * saved one is what somebody ordered from. They are allowed to disagree, and
 * the disagreement is the useful part — the same rule the declared-versus-drawn
 * acreage has followed since 2a.0. Nothing here corrects either.
 *
 * **AND IT NEVER FILLS IN A MISSING FIGURE.** A fence with no post spacing
 * recorded produces a note saying so rather than a count off a default nobody
 * chose. See `core/takeoff.ts`; that discipline is the whole reason the number
 * on this screen is worth ordering from.
 */
export function PlanTakeoff({
  plan,
  lengthUnit,
  canEdit,
}: {
  plan: PlanView;
  lengthUnit: LengthUnit;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  // The SAME function the action will validate against, so the numbers on
  // screen are the ones that get stored.
  const computed = useMemo(
    () => takeoffFor(plan.features, lengthUnit),
    [lengthUnit, plan.features],
  );
  const computedTotals = useMemo(
    () => totalsOf(computed.lines),
    [computed.lines],
  );

  const totalsFrom = (
    items: PlanView["items"],
  ): TakeoffTotal[] => {
    const byKey = new Map<string, TakeoffTotal>();
    for (const item of items) {
      const key = `${item.material}:${item.unit}`;
      const found = byKey.get(key);
      if (found) found.quantity = Math.round((found.quantity + item.quantity) * 100) / 100;
      else {
        byKey.set(key, {
          material: item.material,
          label: item.label,
          quantity: item.quantity,
          unit: item.unit as TakeoffUnit,
        });
      }
    }
    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  };

  const savedTotals = useMemo(() => totalsFrom(plan.items), [plan.items]);

  /**
   * Which rows a re-take would even touch.
   *
   * **A HAND-ADDED LINE HAS NO "NOW", AND SAYING IT IS ZERO IS A LIE.** Nothing
   * recomputes insulators from the geometry, so comparing them against a
   * computed list reports 300 going to 0 — which reads as "you do not need any
   * of these any more" rather than "this one is not counted off anything".
   * Found by adding a line of insulators to a saved plan.
   */
  const counted = useMemo(
    () => new Set(
      plan.items
        .filter((item) => item.sourceFeatureId !== null)
        .map((item) => `${item.material}:${item.unit}`),
    ),
    [plan.items],
  );

  const drift = useMemo(
    () =>
      plan.takenOffAt
        ? driftOf(
            savedTotals.filter((t) => counted.has(`${t.material}:${t.unit}`)),
            computedTotals,
          )
        : [],
    [computedTotals, counted, plan.takenOffAt, savedTotals],
  );

  const cost = plan.items.reduce(
    (sum, item) =>
      item.unitCost === null ? sum : sum + item.quantity * item.unitCost,
    0,
  );
  const priced = plan.items.some((item) => item.unitCost !== null);

  function save() {
    startTransition(async () => {
      const result = await saveTakeoffAction({
        planId: plan.id,
        lines: computed.lines.map((line) => ({
          material: line.material,
          label: line.label,
          quantity: line.quantity,
          unit: line.unit,
          sourceFeatureId: line.sourceFeatureId,
        })),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("List saved");
      router.refresh();
    });
  }

  function addLine(formData: FormData) {
    startTransition(async () => {
      const rawCost = String(formData.get("unitCost") ?? "").trim();
      const result = await addPlanItemAction({
        planId: plan.id,
        material: String(formData.get("material") ?? ""),
        label: String(formData.get("label") ?? ""),
        quantity: Number(formData.get("quantity") ?? 0),
        unit: String(formData.get("unit") ?? "each"),
        // Blank means nobody typed a price, which is not the same as free.
        unitCost: rawCost === "" ? null : Number(rawCost),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Added");
      setAdding(false);
      router.refresh();
    });
  }

  function removeItem(id: string) {
    startTransition(async () => {
      const result = await deletePlanItemAction({ id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function removePlan() {
    startTransition(async () => {
      const result = await deletePlanAction({ id: plan.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Plan removed — what it proposed is still on the plan");
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">
          {plan.name}
          <span className="ml-2 font-normal text-muted-foreground">
            {plan.features.length}{" "}
            {plan.features.length === 1 ? "thing" : "things"} proposed
          </span>
        </h3>
        {plan.takenOffAt ? (
          <Badge variant="secondary">List saved</Badge>
        ) : (
          <Badge variant="outline">Not taken off yet</Badge>
        )}
      </div>

      {computedTotals.length === 0 && plan.items.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing to count yet — draw what this plan proposes.
        </p>
      ) : (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead className="text-right">
                {plan.takenOffAt ? "Saved" : "From the drawing"}
              </TableHead>
              {plan.takenOffAt && (
                <TableHead className="text-right">Now</TableHead>
              )}
              <TableHead className="text-right">Price</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(plan.takenOffAt ? savedTotals : computedTotals).map((total) => {
              const item = plan.items.find(
                (i) => i.material === total.material && i.unit === total.unit,
              );
              const moved = drift.find(
                (d) => d.material === total.material && d.unit === total.unit,
              );
              return (
                <TableRow key={`${total.material}:${total.unit}`}>
                  <TableCell className="font-medium">{total.label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {total.quantity.toLocaleString("en-US")} {total.unit}
                  </TableCell>
                  {plan.takenOffAt && (
                    <TableCell className="text-right tabular-nums">
                      {!counted.has(`${total.material}:${total.unit}`) ? (
                        // Nothing recomputes a hand-added line, so there is no
                        // "now" to compare against — not a zero.
                        <span className="text-muted-foreground">typed in</span>
                      ) : moved ? (
                        <span className="text-warning">
                          {moved.now.toLocaleString("en-US")} {total.unit}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">same</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">
                    {item?.unitCost != null
                      ? money.format(item.unitCost * item.quantity)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && item && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${total.label}`}
                        disabled={pending}
                        onClick={() => removeItem(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {priced && (
        <p className="mt-2 text-right text-sm tabular-nums">
          {money.format(cost)}{" "}
          <span className="text-xs text-muted-foreground">
            for the lines that have a price
          </span>
        </p>
      )}

      {computed.notes.length > 0 && (
        <ul className="mt-3 space-y-1">
          {computed.notes.map((note) => (
            <li key={`${note.featureId}:${note.message}`} className="text-xs text-warning">
              <span className="font-medium">{note.featureName}</span>{" "}
              {note.message}
            </li>
          ))}
        </ul>
      )}

      {drift.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          The drawing has changed since this list was saved. Both figures are
          kept as they are — take it off again when you are ready to reorder.
        </p>
      )}

      {canEdit && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={save} disabled={pending}>
            {plan.takenOffAt ? "Take it off again" : "Save this list"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAdding((open) => !open)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add a line
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={removePlan}
          >
            Remove plan
          </Button>
        </div>
      )}

      {canEdit && adding && (
        <form action={addLine} className="mt-3 grid gap-2 sm:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor={`${plan.id}-material`}>Material</Label>
            <Input
              id={`${plan.id}-material`}
              name="material"
              placeholder="insulator"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${plan.id}-label`}>Called</Label>
            <Input id={`${plan.id}-label`} name="label" placeholder="Insulators" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${plan.id}-quantity`}>How many</Label>
            <Input
              id={`${plan.id}-quantity`}
              name="quantity"
              type="number"
              min={0.01}
              step="0.01"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${plan.id}-unit`}>Unit</Label>
            <select
              id={`${plan.id}-unit`}
              name="unit"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              defaultValue="each"
            >
              <option value="each">each</option>
              <option value={lengthUnit === "foot" ? "ft" : "m"}>
                {lengthUnit === "foot" ? "ft" : "m"}
              </option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${plan.id}-cost`}>Each costs</Label>
            <Input
              id={`${plan.id}-cost`}
              name="unitCost"
              type="number"
              min={0}
              step="0.01"
              placeholder="—"
            />
          </div>
          <div className="sm:col-span-5">
            <Button size="sm" type="submit" disabled={pending}>
              Add it
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
