"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Filter, Pin, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  FILTER_FIELDS,
  MAX_CONDITIONS,
  RELATIVE_DATES,
  conditionProblem,
  encodeCondition,
  filterField,
  operatorLabel,
  operatorsFor,
  relativeDateLabel,
  sameConditions,
  type FilterCondition,
  type ViewSort,
} from "../core/views";
import {
  deleteViewAction,
  pinViewAction,
  saveViewAction,
  updateViewAction,
} from "../view-actions";

/**
 * The view picker and the filter panel.
 *
 * EXPLORE FIRST, NAME IT LATER. Nobody creates a view up front. Filters apply
 * to the list immediately — they live in the URL, so the result is a link
 * somebody can send — and only once the list is actually useful does "Save as
 * view" appear. Making somebody name a thing before they know whether it is
 * worth keeping is how a saved-views feature ends up with three views in it.
 *
 * The panel therefore has three states, and the middle one is the point:
 * showing a view, showing a view WITH UNSAVED CHANGES, and showing an ad-hoc
 * filter that belongs to no view at all.
 */

export interface ViewOption {
  id: string;
  name: string;
  isBuiltIn: boolean;
  isShared: boolean;
  isMine: boolean;
  conditions: FilterCondition[];
}

export function ViewControls({
  views,
  current,
  conditions,
  sort,
  pinnedViewId,
  total,
}: {
  views: ViewOption[];
  current: ViewOption;
  conditions: FilterCondition[];
  sort: ViewSort;
  pinnedViewId: string | null;
  total: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<FilterCondition[]>(conditions);
  const [saveOpen, setSaveOpen] = useState(false);

  const dirty = !sameConditions(conditions, current.conditions);

  /** Push a filter into the URL. Paging resets, because page 4 of a different
   *  question is not where anybody wanted to be. */
  function apply(next: FilterCondition[], viewId = current.id): void {
    const params = new URLSearchParams();
    for (const [key, value] of searchParams.entries()) {
      if (key === "f" || key === "page" || key === "view") continue;
      params.append(key, value);
    }
    if (viewId !== "builtin:all") params.set("view", viewId);
    for (const condition of next) params.append("f", encodeCondition(condition));
    router.push(params.toString() ? `?${params}` : "?");
    setPanelOpen(false);
  }

  function selectView(view: ViewOption): void {
    setDraft(view.conditions);
    apply(view.conditions, view.id);
  }

  function pin(viewId: string): void {
    startTransition(async () => {
      const result = await pinViewAction({ viewId });
      if ("error" in result) toast.error(result.error);
      else toast.success("This view opens by default now");
    });
  }

  function removeView(view: ViewOption): void {
    startTransition(async () => {
      const result = await deleteViewAction({ viewId: view.id });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("View deleted");
        selectView(views.find((v) => v.id === "builtin:all")!);
        router.refresh();
      }
    });
  }

  function saveOverExisting(): void {
    startTransition(async () => {
      const result = await updateViewAction({
        viewId: current.id,
        conditions,
        sort,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("View updated");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              {current.name}
              {dirty && <span aria-hidden>*</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {views.map((view) => (
              <DropdownMenuItem
                key={view.id}
                onSelect={() => selectView(view)}
                className="justify-between gap-2"
              >
                <span className="truncate">{view.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {pinnedViewId === view.id && <Pin className="size-3" />}
                  {view.id === current.id && <Check className="size-3.5" />}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => pin(current.id)} disabled={pending}>
              <Pin className="mr-2 size-3.5" /> Open this one by default
            </DropdownMenuItem>
            {!current.isBuiltIn && current.isMine && (
              <DropdownMenuItem
                onSelect={() => removeView(current)}
                disabled={pending}
              >
                <Trash2 className="mr-2 size-3.5" /> Delete this view
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setDraft(conditions.length > 0 ? conditions : []);
            setPanelOpen((open) => !open);
          }}
        >
          <Filter className="size-3.5" />
          Filter
          {conditions.length > 0 && (
            <Badge variant="secondary">{conditions.length}</Badge>
          )}
        </Button>

        {/*
          Save appears only once there is something worth saving. An always-on
          "Save view" button on an unfiltered list is an invitation to create a
          view identical to the one already open.
        */}
        {dirty && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => setSaveOpen(true)}
            >
              <Save className="size-3.5" /> Save as view
            </Button>
            {!current.isBuiltIn && current.isMine && (
              <Button
                size="sm"
                variant="ghost"
                onClick={saveOverExisting}
                disabled={pending}
              >
                Update “{current.name}”
              </Button>
            )}
          </>
        )}
      </div>

      {panelOpen && (
        <FilterPanel
          draft={draft}
          setDraft={setDraft}
          onApply={() => apply(draft)}
          onClear={() => {
            setDraft([]);
            apply([]);
          }}
        />
      )}

      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        conditions={conditions}
        sort={sort}
        total={total}
      />
    </div>
  );
}

function FilterPanel({
  draft,
  setDraft,
  onApply,
  onClear,
}: {
  draft: FilterCondition[];
  setDraft: (next: FilterCondition[]) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  function update(index: number, patch: Partial<FilterCondition>): void {
    const next = draft.map((condition, i) =>
      i === index ? { ...condition, ...patch } : condition,
    );
    // Changing the FIELD resets the rest: an operator and a value that made
    // sense for a date are nonsense for a name, and leaving them would show a
    // filter that cannot be applied.
    if (patch.field) {
      const field = filterField(patch.field);
      next[index] = {
        field: patch.field,
        operator: field ? operatorsFor(field.type)[0] : "equals",
        value: field?.options?.[0]?.value ?? "",
      };
    }
    setDraft(next);
  }

  // NOT `draft.map(conditionProblem)`: the callback receives the index as its
  // second argument, which is now the field-set parameter. The compiler caught
  // it, and the arrow keeps it caught.
  const problems = draft.map((condition) => conditionProblem(condition));
  const ready = problems.every((p) => p === null);

  return (
    <div className="space-y-3 rounded-md border p-3">
      {draft.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No filters. The list is showing everything you can see.
        </p>
      )}

      {draft.map((condition, index) => {
        const field = filterField(condition.field);
        return (
          <div key={index} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={condition.field}
                onChange={(e) => update(index, { field: e.target.value })}
              >
                {FILTER_FIELDS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>

              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={condition.operator}
                onChange={(e) =>
                  update(index, {
                    operator: e.target.value as FilterCondition["operator"],
                  })
                }
              >
                {operatorsFor(field?.type ?? "text").map((op) => (
                  <option key={op} value={op}>
                    {operatorLabel(op)}
                  </option>
                ))}
              </select>

              <ValueInput
                field={condition.field}
                value={condition.value}
                onChange={(value) => update(index, { value })}
              />

              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setDraft(draft.filter((_, i) => i !== index))}
              >
                <X className="size-4" />
                <span className="sr-only">Remove filter</span>
              </Button>
            </div>
            {problems[index] && (
              <p className="text-xs text-destructive">{problems[index]}</p>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={draft.length >= MAX_CONDITIONS}
          onClick={() =>
            setDraft([
              ...draft,
              { field: "name", operator: "contains", value: "" },
            ])
          }
        >
          <Plus className="mr-1.5 size-3.5" /> Add filter
        </Button>
        <Button size="sm" onClick={onApply} disabled={!ready}>
          Apply
        </Button>
        {draft.length > 0 && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear all
          </Button>
        )}
        {/*
          Conditions are ANDed, and the panel says so rather than leaving
          somebody to discover it. OR is a real want and a real parser; it is
          recorded as an open item rather than half-built here.
        */}
        {draft.length > 1 && (
          <span className="text-xs text-muted-foreground">
            Records must match all of these.
          </span>
        )}
      </div>
    </div>
  );
}

/** The right control for the field's type — a picker, a toggle, or a box. */
function ValueInput({
  field,
  value,
  onChange,
}: {
  field: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const definition = filterField(field);
  if (!definition) return null;

  if (definition.type === "enum" || definition.type === "boolean") {
    const options =
      definition.options ??
      [
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ];
    return (
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (definition.type === "date") {
    return (
      <span className="flex items-center gap-2">
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={
            (RELATIVE_DATES as readonly string[]).includes(value) ? value : "exact"
          }
          onChange={(e) =>
            onChange(e.target.value === "exact" ? "" : e.target.value)
          }
        >
          {RELATIVE_DATES.map((token) => (
            <option key={token} value={token}>
              {relativeDateLabel(token)}
            </option>
          ))}
          <option value="exact">a date…</option>
        </select>
        {!(RELATIVE_DATES as readonly string[]).includes(value) && (
          <Input
            type="date"
            className="h-9 w-40"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </span>
    );
  }

  return (
    <Input
      className="h-9 w-48"
      value={value}
      placeholder="Value"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function SaveViewDialog({
  open,
  onOpenChange,
  conditions,
  sort,
  total,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conditions: FilterCondition[];
  sort: ViewSort;
  total: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [isShared, setIsShared] = useState(false);

  function save(): void {
    startTransition(async () => {
      const result = await saveViewAction({
        name: name.trim(),
        conditions,
        sort,
        isShared,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("View saved");
        onOpenChange(false);
        setName("");
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this view</DialogTitle>
          <DialogDescription>
            {total === 1 ? "1 record" : `${total} records`} match right now.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="view-name">Name</Label>
            <Input
              id="view-name"
              value={name}
              placeholder="Chasing this quarter"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="view-shared">Share with the team</Label>
              {/*
                Says the thing people worry about. A view is a saved question,
                and the answer is still computed per reader — so sharing one
                cannot show anybody a record they could not already open.
              */}
              <p className="text-xs text-muted-foreground">
                Everyone sees the same filter, but still only the records they
                have access to.
              </p>
            </div>
            <Switch
              id="view-shared"
              checked={isShared}
              onCheckedChange={setIsShared}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !name.trim()}>
            {pending ? "Saving…" : "Save view"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
