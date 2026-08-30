"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Navigation, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteFeatureAction,
  setFeatureStatusAction,
  updateFeatureAction,
} from "../actions";
import {
  FEATURE_STATUSES,
  FEATURE_STATUS_LABELS,
  LINE_WIDTH_PRESETS,
  featureKindLabel,
  type FeatureStatus,
  type TenantFeatureKind,
} from "../core/features";
import { asFeatureGeometry, geometryLengthM, shapeOf } from "../core/geo";
import { NavigatePanel } from "./navigate-panel";
import { formatLength, type LengthUnit } from "../core/length";
import type { PlanFeature } from "./site-plan-map";

export interface PanelFeature extends PlanFeature {
  notes: string;
  attributes: Record<string, string | number | boolean>;
  fedById: string | null;
}

/**
 * The selected feature: what it is, how long it is, and what is true about it.
 *
 * **THE DETAILS ARE A FREE KEY/VALUE LIST IN THIS SLICE, ON PURPOSE.** A form
 * with a "strands" box for a fence and a "depth" box for a waterline needs the
 * pack to know which keys belong to which kind — and the kinds are an OPEN
 * taxonomy, so it would only ever know some of them. Nothing here READS an
 * attribute yet; it displays them. The slice that computes from them (2b.1, the
 * takeoff) is the one that earns the right to name `spacing_ft`, because that
 * is when a wrong key stops being cosmetic.
 *
 * PROMOTION IS ITS OWN BUTTON, not a dropdown value among others. Turning a
 * proposal into a fact is the act the whole status column exists for, and it is
 * the one somebody will look for by name.
 */
export function FeaturePanel({
  feature,
  kinds,
  sources,
  lengthUnit,
  canEdit,
  onClose,
}: {
  feature: PanelFeature;
  kinds: TenantFeatureKind[];
  /** Everything that could feed this one — points, mostly, and never itself. */
  sources: { id: string; label: string }[];
  lengthUnit: LengthUnit;
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState<[string, string][]>(
    Object.entries(feature.attributes).map(([k, v]) => [k, String(v)]),
  );
  // "default" rather than "" — a Radix Select treats an empty value as no
  // selection and renders a blank trigger, which reads as a missing setting.
  const widthValue =
    feature.lineWidth === null ? "default" : String(feature.lineWidth);

  /**
   * Whether the field screen is open for this feature.
   *
   * **KEYED ON THE FEATURE ID, NOT A BOOLEAN.** The panel stays mounted while
   * you click from one fence to the next, and a plain flag would leave you
   * being navigated to the thing you just stopped looking at — with the
   * geolocation watch still running under a heading naming something else.
   */
  const [navigatingId, setNavigatingId] = useState<string | null>(null);
  const navigating = navigatingId === feature.id;

  const geometry = asFeatureGeometry(feature.geometry);
  const length = geometry ? geometryLengthM(geometry) : null;
  const shape = geometry ? shapeOf(geometry) : null;

  function promote(status: FeatureStatus) {
    startTransition(async () => {
      const result = await setFeatureStatusAction({ id: feature.id, status });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        status === "built"
          ? "Marked as built"
          : `Marked as ${FEATURE_STATUS_LABELS[status].toLowerCase()}`,
      );
      router.refresh();
    });
  }

  function save(formData: FormData) {
    // The bag is REPLACED rather than merged, which is what lets a detail be
    // removed — so the whole current list is sent every time.
    const attributes: Record<string, string> = {};
    for (const [key, value] of details) {
      if (key.trim() && value.trim()) attributes[key.trim()] = value.trim();
    }

    startTransition(async () => {
      const result = await updateFeatureAction({
        id: feature.id,
        name: String(formData.get("name") ?? ""),
        kind: String(formData.get("kind") ?? feature.kind),
        notes: String(formData.get("notes") ?? ""),
        fedById: String(formData.get("fedById") ?? "") || null,
        lineWidth:
          String(formData.get("lineWidth") ?? "default") === "default"
            ? null
            : Number(formData.get("lineWidth")),
        attributes,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteFeatureAction({ id: feature.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Deleted");
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium">
              {feature.name || featureKindLabel(feature.kind)}
            </h3>
            <StatusBadge status={feature.status} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {featureKindLabel(feature.kind)}
            {length !== null && shape !== "point" && (
              <>
                {" · "}
                <span className="tabular-nums">
                  {formatLength(length, lengthUnit)}
                </span>
              </>
            )}
            {!geometry && " · not drawn yet"}
          </p>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {!editing && (
        <>
          {Object.keys(feature.attributes).length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {Object.entries(feature.attributes).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">
                    {key.replace(/_/g, " ")}
                  </dt>
                  <dd className="tabular-nums">
                    {typeof value === "boolean" ? (value ? "yes" : "no") : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {feature.notes && (
            <p className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">
              {feature.notes}
            </p>
          )}
        </>
      )}

      {/*
        **NAVIGATION IS NOT OWNER-GATED AND NOT EDIT-GATED.** Walking to a
        corner changes nothing; the person setting the posts is often not the
        person who drew them, and refusing them the screen because they cannot
        edit a fence would be the app getting in the way of the one job it was
        built for.
      */}
      {geometry && !editing && (
        <div className="mt-4">
          {navigating ? (
            <NavigatePanel
              name={feature.name || featureKindLabel(feature.kind)}
              geometry={geometry}
              lengthUnit={lengthUnit}
              onClose={() => setNavigatingId(null)}
            />
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setNavigatingId(feature.id)}
            >
              <Navigation className="mr-2 h-4 w-4" />
              Take me there
            </Button>
          )}
        </div>
      )}

      {canEdit && !editing && (
        <div className="mt-4 flex flex-wrap gap-2">
          {feature.status === "planned" && (
            <Button size="sm" onClick={() => promote("built")} disabled={pending}>
              <Check className="mr-2 h-4 w-4" />
              It is built
            </Button>
          )}
          {feature.status === "built" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => promote("removed")}
              disabled={pending}
            >
              Mark as removed
            </Button>
          )}
          {feature.status === "removed" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => promote("built")}
              disabled={pending}
            >
              It is back
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit details
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={remove}
            disabled={pending}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      )}

      {editing && (
        <form action={save} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={feature.name}
                placeholder={featureKindLabel(feature.kind)}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kind">Kind</Label>
              <Select name="kind" defaultValue={feature.kind}>
                <SelectTrigger id="kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((kind) => (
                    <SelectItem key={kind.kind} value={kind.kind}>
                      {kind.label}
                    </SelectItem>
                  ))}
                  {/* A kind the pack has never heard of still has to be
                      selectable, or opening this form would silently change it. */}
                  {!kinds.some((k) => k.kind === feature.kind) && (
                    <SelectItem value={feature.kind}>
                      {featureKindLabel(feature.kind)}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {sources.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="fedById">Fed by</Label>
              <Select name="fedById" defaultValue={feature.fedById ?? ""}>
                <SelectTrigger id="fedById">
                  <SelectValue placeholder="Nothing" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nothing</SelectItem>
                  {sources
                    .filter((source) => source.id !== feature.id)
                    .map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="lineWidth">Thickness</Label>
            <Select name="lineWidth" defaultValue={widthValue}>
              <SelectTrigger id="lineWidth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* The kind's own weight is a real choice and the default one,
                    so it is an option rather than an empty state. */}
                <SelectItem value="default">
                  Default for {featureKindLabel(feature.kind).toLowerCase()}
                </SelectItem>
                {LINE_WIDTH_PRESETS.map((preset) => (
                  <SelectItem key={preset.width} value={String(preset.width)}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Details</Label>
            <div className="space-y-2">
              {details.map(([key, value], index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={key}
                    placeholder="wire_count"
                    onChange={(event) =>
                      setDetails((rows) =>
                        rows.map((row, i) =>
                          i === index ? [event.target.value, row[1]] : row,
                        ),
                      )
                    }
                  />
                  <Input
                    value={value}
                    placeholder="3"
                    onChange={(event) =>
                      setDetails((rows) =>
                        rows.map((row, i) =>
                          i === index ? [row[0], event.target.value] : row,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove detail"
                    onClick={() =>
                      setDetails((rows) => rows.filter((_, i) => i !== index))
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDetails((rows) => [...rows, ["", ""]])}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add a detail
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Anything worth recording — strands, whether it is hot, how deep it
              is buried. Lowercase names with underscores.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              defaultValue={feature.notes}
              rows={2}
              maxLength={5000}
            />
          </div>

          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                setDetails(
                  Object.entries(feature.attributes).map(([k, v]) => [
                    k,
                    String(v),
                  ]),
                );
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: FeatureStatus }) {
  // A proposal must not read like a fact anywhere, the list included — the same
  // rule the map's symbology follows.
  const variant =
    status === "built" ? "secondary" : status === "planned" ? "outline" : "outline";
  return (
    <Badge
      variant={variant}
      className={status === "removed" ? "text-muted-foreground" : undefined}
    >
      {FEATURE_STATUS_LABELS[status]}
    </Badge>
  );
}

export { FEATURE_STATUSES };
