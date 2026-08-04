"use client";

import type { CrmFieldDef } from "@/db/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { fieldOptions } from "../core/custom-fields";
import type { CustomValue } from "../core/custom-fields";

/**
 * The typed controls for a tenant's custom fields, rendered from the
 * definitions rather than from anything written by hand.
 *
 * KEYED BY DEFINITION ID throughout, matching the storage shape — no place in
 * this component turns a `key` into a lookup, so renaming a field never touches
 * a value. See core/custom-fields.ts.
 *
 * Nothing here is a validation boundary. The controls narrow what is easy to
 * type, and `sanitizeCustomValues` decides what is allowed, server-side, on
 * every write. A control that looked authoritative would invite somebody to
 * skip the check that actually matters.
 */
export function CustomFieldInputs({
  defs,
  values,
  issues,
  onChange,
  disabled,
}: {
  defs: CrmFieldDef[];
  values: Record<string, unknown>;
  issues?: Record<string, string>;
  onChange: (fieldId: string, value: CustomValue | undefined) => void;
  disabled?: boolean;
}) {
  if (defs.length === 0) return null;

  return (
    <div className="space-y-4 rounded-md border px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Your fields</h2>
        <p className="text-xs text-muted-foreground">
          Set up under Fields in this module.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {defs.map((def) => {
          const id = `crm-cf-${def.id}`;
          const raw = values[def.id];
          const issue = issues?.[def.id];

          return (
            <div
              key={def.id}
              className={
                def.fieldType === "multi_select" ? "space-y-2 sm:col-span-2" : "space-y-2"
              }
            >
              <Label htmlFor={id} className="flex items-center gap-2">
                {def.label}
                {def.isRequired && (
                  // Says WHEN it is required. "Required" alone reads as "you
                  // cannot save", which is not what this rule does.
                  <Badge variant="outline" className="font-normal">
                    needed to change stage
                  </Badge>
                )}
              </Label>

              <FieldControl
                id={id}
                def={def}
                raw={raw}
                disabled={disabled}
                onChange={(v) => onChange(def.id, v)}
              />

              {def.helpText && !issue && (
                <p className="text-xs text-muted-foreground">{def.helpText}</p>
              )}
              {issue && <p className="text-xs text-destructive">{issue}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FieldControl({
  id,
  def,
  raw,
  disabled,
  onChange,
}: {
  id: string;
  def: CrmFieldDef;
  raw: unknown;
  disabled?: boolean;
  onChange: (value: CustomValue | undefined) => void;
}) {
  const options = fieldOptions(def);

  switch (def.fieldType) {
    case "boolean":
      return (
        <div className="flex h-9 items-center">
          <Switch
            id={id}
            disabled={disabled}
            checked={raw === true}
            onCheckedChange={(on) => onChange(on)}
          />
        </div>
      );

    case "select":
      return (
        <Select
          disabled={disabled}
          value={typeof raw === "string" && raw ? raw : "__none"}
          // A select with no way back to empty traps the first wrong answer,
          // so "not set" is an explicit choice rather than an absent one.
          onValueChange={(v) => onChange(v === "__none" ? undefined : v)}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Not set</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "multi_select": {
      const chosen = Array.isArray(raw) ? (raw as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1.5" id={id}>
          {options.map((o) => {
            const on = chosen.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => {
                  const next = on
                    ? chosen.filter((c) => c !== o.value)
                    : [...chosen, o.value];
                  onChange(next.length === 0 ? undefined : next);
                }}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  on
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "hover:bg-accent/40"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }

    case "number":
      return (
        <Input
          id={id}
          type="number"
          disabled={disabled}
          value={typeof raw === "number" ? String(raw) : ""}
          onChange={(e) =>
            // Sent through as the raw string; the server coerces. Parsing here
            // too would be a second opinion about what a number is.
            onChange(e.target.value === "" ? undefined : (e.target.value as never))
          }
        />
      );

    case "date":
      return (
        <Input
          id={id}
          type="date"
          disabled={disabled}
          value={typeof raw === "string" ? raw : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );

    case "url":
      return (
        <Input
          id={id}
          type="url"
          inputMode="url"
          placeholder="https://"
          disabled={disabled}
          value={typeof raw === "string" ? raw : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );

    default:
      return (
        <Input
          id={id}
          disabled={disabled}
          value={typeof raw === "string" ? raw : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
  }
}
