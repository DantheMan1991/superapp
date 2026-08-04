"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Loader2, Plus, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CrmFieldDef, CrmFieldType } from "@/db/schema";
import { fieldOptions, isChoiceType } from "../core/custom-fields";
import {
  createFieldDefAction,
  setFieldDefArchivedAction,
  updateFieldDefAction,
} from "../actions";

const TYPE_LABELS: Record<CrmFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes / no",
  select: "One choice",
  multi_select: "Several choices",
  url: "Link",
};

/** Derive a key from a label so nobody has to think about the format. */
function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([^a-z])/, "f$1")
    .slice(0, 63);
}

export function FieldManager({ defs }: { defs: CrmFieldDef[] }) {
  const live = defs.filter((d) => !d.archivedAt);
  const archived = defs.filter((d) => d.archivedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Fields on every record</h2>
          <p className="text-xs text-muted-foreground">
            {live.length === 0
              ? "None yet."
              : `${live.length} field${live.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <FieldDialog mode="create" />
      </div>

      {live.length === 0 ? (
        <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          Add the things you track that the standard fields do not cover.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {live.map((def) => (
            <FieldRow key={def.id} def={def} />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Archived</h2>
          <p className="text-xs text-muted-foreground">
            These no longer appear on records. Everything already entered against
            them is kept — that is why they are archived rather than deleted.
          </p>
          <ul className="divide-y rounded-md border">
            {archived.map((def) => (
              <FieldRow key={def.id} def={def} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FieldRow({ def }: { def: CrmFieldDef }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isArchived = !!def.archivedAt;

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{def.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {TYPE_LABELS[def.fieldType]} · {def.key}
          {isChoiceType(def.fieldType) &&
            ` · ${fieldOptions(def).length} option${fieldOptions(def).length === 1 ? "" : "s"}`}
        </p>
      </div>

      {def.isRequired && !isArchived && (
        <Badge variant="outline" className="font-normal">
          needed to change stage
        </Badge>
      )}

      {!isArchived && <FieldDialog mode="edit" def={def} />}

      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setFieldDefArchivedAction({
              fieldId: def.id,
              expectedVersion: def.version,
              archived: !isArchived,
            });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success(
              isArchived
                ? "Field restored"
                : "Field archived. Values already entered are kept.",
            );
            router.refresh();
          })
        }
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isArchived ? (
          <ArchiveRestore className="size-4" />
        ) : (
          <Archive className="size-4" />
        )}
      </Button>
    </li>
  );
}

function FieldDialog({
  mode,
  def,
}: {
  mode: "create" | "edit";
  def?: CrmFieldDef;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(def?.label ?? "");
  const [key, setKey] = useState(def?.key ?? "");
  // Only the user editing the key stops it tracking the label. Two fields that
  // must agree, where one is derivable, should not both need typing.
  const [keyTouched, setKeyTouched] = useState(mode === "edit");
  const [fieldType, setFieldType] = useState<CrmFieldType>(def?.fieldType ?? "text");
  const [isRequired, setIsRequired] = useState(def?.isRequired ?? false);
  const [helpText, setHelpText] = useState(def?.helpText ?? "");
  const [options, setOptions] = useState<{ value: string; label: string }[]>(
    def ? fieldOptions(def) : [],
  );
  const [pending, startTransition] = useTransition();

  const effectiveKey = keyTouched ? key : slugifyKey(label);
  const needsOptions = isChoiceType(fieldType);

  function submit() {
    if (label.trim().length === 0) {
      toast.error("Give the field a name");
      return;
    }
    const cleanOptions = options
      .map((o) => ({ value: o.value.trim(), label: o.label.trim() || o.value.trim() }))
      .filter((o) => o.value.length > 0);
    if (needsOptions && cleanOptions.length === 0) {
      toast.error("Add at least one choice");
      return;
    }

    startTransition(async () => {
      const result =
        mode === "create"
          ? await createFieldDefAction({
              key: effectiveKey,
              label: label.trim(),
              fieldType,
              options: cleanOptions,
              isRequired,
              helpText: helpText.trim(),
            })
          : await updateFieldDefAction({
              fieldId: def!.id,
              expectedVersion: def!.version,
              key: effectiveKey,
              label: label.trim(),
              options: cleanOptions,
              isRequired,
              helpText: helpText.trim(),
            });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(mode === "create" ? "Field added" : "Field saved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {mode === "create" ? (
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 size-4" />
          Add a field
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Edit
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "Add a field" : "Edit field"}
            </DialogTitle>
            <DialogDescription>
              This appears on every record in the CRM.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="crm-field-label">Name</Label>
              <Input
                id="crm-field-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Warranty expiry"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="crm-field-key">Reference</Label>
              <Input
                id="crm-field-key"
                value={effectiveKey}
                onChange={(e) => {
                  setKeyTouched(true);
                  setKey(e.target.value);
                }}
                placeholder="warranty_expiry"
              />
              <p className="text-xs text-muted-foreground">
                Used for imports. Safe to change later — it is not what the
                answers are stored against.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="crm-field-type">Type</Label>
              <Select
                value={fieldType}
                onValueChange={(v) => setFieldType(v as CrmFieldType)}
                disabled={mode === "edit"}
              >
                <SelectTrigger id="crm-field-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as CrmFieldType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mode === "edit" && (
                <p className="text-xs text-muted-foreground">
                  The type cannot change — existing answers would stop matching
                  it. Archive this field and add a new one instead.
                </p>
              )}
            </div>

            {needsOptions && (
              <div className="space-y-2">
                <Label>Choices</Label>
                <div className="space-y-2">
                  {options.map((o, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={o.label}
                        onChange={(e) =>
                          setOptions((prev) =>
                            prev.map((p, j) =>
                              j === i
                                ? {
                                    label: e.target.value,
                                    // The stored value tracks the label only
                                    // while the option is NEW. Changing it on
                                    // an existing option would orphan every
                                    // answer already given.
                                    value: def
                                      ? p.value || slugifyKey(e.target.value)
                                      : slugifyKey(e.target.value),
                                  }
                                : p,
                            ),
                          )
                        }
                        placeholder="North"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setOptions((prev) => prev.filter((_, j) => j !== i))
                        }
                        aria-label="Remove choice"
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setOptions((prev) => [...prev, { value: "", label: "" }])
                  }
                >
                  <Plus className="mr-2 size-4" />
                  Add a choice
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="crm-field-help">Hint (optional)</Label>
              <Input
                id="crm-field-help"
                value={helpText}
                onChange={(e) => setHelpText(e.target.value)}
                placeholder="Shown under the field"
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-md border px-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="crm-field-required">Needed to change stage</Label>
                <p className="text-xs text-muted-foreground">
                  Records can still be created and saved without it. It is asked
                  for when the stage moves, so imports and quick captures are not
                  blocked.
                </p>
              </div>
              <Switch
                id="crm-field-required"
                checked={isRequired}
                onCheckedChange={setIsRequired}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {mode === "create" ? "Add field" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
