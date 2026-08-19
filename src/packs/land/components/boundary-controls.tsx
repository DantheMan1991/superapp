"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { setParcelBoundaryAction, setZoneBoundaryAction } from "../actions";
import { boundaryAreaAcres, parseBoundary } from "../core/geo";
import { formatArea, fromAcres, type AreaUnit } from "../core/area";

/** Discriminated on purpose: `"acres" in preview` narrows badly across an
 * anonymous union, and the compiler was right to complain. */
type Preview = { ok: true; acres: number } | { ok: false; error: string };

/**
 * Paste a boundary.
 *
 * **THIS IS THE SLICE'S ENTRY PATH, AND IT IS DELIBERATELY NOT THE MAP.**
 * Drawing on aerial imagery is 2a.1, and it is the better answer for ground
 * nobody has a file for — but most farms can already get a boundary out of a
 * county GIS site, a farm-mapping app, or geojson.io in about a minute, and
 * making them wait for a drawing surface before the geometry column does
 * anything would be shipping a schema and calling it a feature.
 *
 * The paste box does not become dead weight when the map lands: a file from the
 * county is more accurate than anything traced by hand, and this stays the way
 * to use it.
 */
export function BoundaryForm({
  target,
  id,
  name,
  declaredAcres,
  unit,
  hasBoundary,
}: {
  target: "zone" | "parcel";
  id: string;
  name: string;
  declaredAcres: number | null;
  unit: AreaUnit;
  hasBoundary: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");

  /**
   * The SAME parser and the SAME area formula the server will run, in the box,
   * as you paste. Not a preview of a guess — `core/geo.ts` is pure precisely so
   * both sides can run it, so what this says the boundary measures is what gets
   * stored.
   */
  const preview: Preview | null = useMemo(() => {
    if (!draft.trim()) return null;
    const result = parseBoundary(draft);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, acres: boundaryAreaAcres(result.boundary) };
  }, [draft]);

  const action = target === "zone" ? setZoneBoundaryAction : setParcelBoundaryAction;

  function save(geojson: string | null) {
    startTransition(async () => {
      const result = await action({ id, geojson });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(geojson ? "Boundary saved" : "Boundary removed");
      setDraft("");
      setOpen(false);
      router.refresh();
    });
  }

  const difference =
    preview?.ok && declaredAcres !== null ? preview.acres - declaredAcres : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {hasBoundary ? "Replace boundary" : "Add a boundary"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            Paste the GeoJSON for this {target}. A county GIS export, a farm
            mapping app, or geojson.io all produce it — a Feature or a whole
            FeatureCollection is fine as long as it holds one shape.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor={`geojson-${id}`}>GeoJSON</Label>
            <Textarea
              id={`geojson-${id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              className="font-mono text-xs"
              placeholder={'{"type":"Polygon","coordinates":[[[-96.1,40.0], …]]}'}
            />
          </div>

          {preview && !preview.ok && (
            <p className="text-sm text-destructive">{preview.error}</p>
          )}

          {preview?.ok && (
            <div className="rounded-md border p-3 text-sm">
              <p>
                That boundary measures{" "}
                <span className="font-medium tabular-nums">
                  {formatArea(preview.acres, unit)}
                </span>
                .
              </p>
              {declaredAcres === null ? (
                <p className="mt-1 text-muted-foreground">
                  {/* Never written back. The declared figure is the deed's, and
                      a measured one arriving is not a reason to overwrite it. */}
                  No area is recorded for this {target}, and saving a boundary
                  does not fill it in — this stays a measurement, not a claim.
                </p>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  You have {formatArea(declaredAcres, unit)} recorded
                  {difference !== null && Math.abs(difference) >= 0.0001
                    ? `, a difference of ${
                        difference > 0 ? "+" : "−"
                      }${Math.abs(fromAcres(difference, unit)).toFixed(2)}`
                    : ""}
                  . Both are kept; nothing is overwritten.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {hasBoundary ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => save(null)}
            >
              {/* A boundary traced wrong is worse than none, because everything
                  downstream treats it as measured. */}
              Remove the boundary
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            disabled={pending || !preview?.ok}
            onClick={() => save(draft)}
          >
            {pending ? "Saving…" : "Save boundary"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
