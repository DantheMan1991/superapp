"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Package, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/app/panel";
import { formatMoney } from "@/lib/money";
import {
  createAssemblyAction,
  deleteAssemblyFromLibraryAction,
} from "../assembly-actions";

/**
 * THE ASSEMBLY LIBRARY (X10).
 *
 * The founder: *"how do we control what sub members get put on an item. When
 * to include equipment hours, when to include labor materials etc... right
 * now I'm struggling to see that we are going to get the consistent items
 * being put on the estimate in the way I want with the verbiage I want."*
 *
 * **An assembly is the answer to that question, and until now there was
 * nowhere to look at one.** Saving an item as an assembly was a click; the
 * library itself had no screen, so you could not see what you had, could not
 * fix a line, and could not make one without first building an estimate item
 * to save from. A library you cannot open is not a library.
 */
export interface AssemblyListRow {
  id: string;
  name: string;
  per: string;
  lineCount: number;
  costCents: number;
  notes: string;
  /** A line for each room it is in, rather than one naming them all (X11). */
  perRoom: boolean;
}

export function AssemblyLibrary({
  rows,
  canWrite,
  symbol,
}: {
  rows: AssemblyListRow[];
  canWrite: boolean;
  symbol: string | null;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [per, setPer] = useState("1");
  const [unit, setUnit] = useState("");
  const [pending, startTransition] = useTransition();

  function create() {
    if (name.trim() === "") return;
    startTransition(async () => {
      try {
        const result = await createAssemblyAction({
          name,
          drivingQuantity: per,
          drivingUnit: unit,
          /**
           * One line to start with, because an assembly with none is not one
           * — the ops refuse it, and a new assembly that failed to save
           * would be a worse first impression than an empty row to fill in.
           */
          lines: [
            {
              description: name.trim(),
              quantityThousandths: 1_000,
              unitCostCents: 0,
              markupPpm: 0,
              unitPriceCents: 0,
            },
          ],
        });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        setAdding(false);
        setName("");
        setPer("1");
        setUnit("");
        router.push(`/dashboard/m/jobs/assemblies/${result.id}`);
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-heading text-sm font-medium tracking-heading">
              <Package className="size-4 text-muted-foreground" /> Your assemblies
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              An item you build the same way every time — its lines, its wording, its split
              between labour, material and equipment. The walk uses one instead of working the
              lines out for itself, which is how a phase comes out the same on every bid.
            </p>
          </div>
          {canWrite && !adding && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 size-4" /> New assembly
            </Button>
          )}
        </div>

        {adding && (
          <form
            className="mt-4 rounded-md border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <Label htmlFor="asm-name" className="text-xs">
                  What you call it
                </Label>
                <Input
                  id="asm-name"
                  className="mt-1"
                  value={name}
                  maxLength={200}
                  placeholder="Footing, poured"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="asm-per" className="text-xs">
                  Priced per
                </Label>
                <Input
                  id="asm-per"
                  className="mt-1"
                  value={per}
                  maxLength={40}
                  onChange={(e) => setPer(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="asm-unit" className="text-xs">
                  of
                </Label>
                <Input
                  id="asm-unit"
                  className="mt-1"
                  value={unit}
                  maxLength={24}
                  placeholder="lf"
                  onChange={(e) => setUnit(e.target.value)}
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Everything scales off that size. <span className="font-medium">1</span> of a blank
              unit is a lump; <span className="font-medium">100 lf</span> means the lines below
              are what a hundred feet of it takes.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending || name.trim() === ""}>
                Make it
              </Button>
            </div>
          </form>
        )}

        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing here yet. The quickest way to a first one is to build an item on a real
            estimate the way you want it, then press the package icon on that item — it becomes
            an assembly with your lines and your wording already in it.
          </p>
        ) : (
          <ul className="mt-4 divide-y rounded-md border">
            {rows.map((a) => (
              <Row key={a.id} row={a} canWrite={canWrite} symbol={symbol} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Row({
  row,
  canWrite,
  symbol,
}: {
  row: AssemblyListRow;
  canWrite: boolean;
  symbol: string | null;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
      <Link
        href={`/dashboard/m/jobs/assemblies/${row.id}`}
        className="min-w-0 flex-1 text-sm font-medium underline-offset-2 hover:underline"
      >
        {row.name}
      </Link>
      <span className="text-xs text-muted-foreground">
        per {row.per} · {row.lineCount} {row.lineCount === 1 ? "line" : "lines"}
        {row.perRoom ? " · a line per room" : ""}
      </span>
      <span className="text-sm">{formatMoney(row.costCents, symbol)}</span>
      {row.notes && <span className="w-full text-xs text-muted-foreground">{row.notes}</span>}
      {canWrite &&
        (armed ? (
          <span className="flex items-center gap-1">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-7"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    const result = await deleteAssemblyFromLibraryAction({ id: row.id });
                    if ("error" in result) toast.error(result.error);
                    else router.refresh();
                  } catch {
                    toast.error("That did not get through. Try again.");
                  }
                })
              }
            >
              Take it out
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setArmed(false)}
              aria-label="Keep it"
            >
              <X className="size-3.5" />
            </Button>
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setArmed(true)}
            aria-label={`Take ${row.name} out of the library`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        ))}
    </li>
  );
}
