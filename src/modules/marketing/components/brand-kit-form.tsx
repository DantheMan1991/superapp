"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BRAND_DISPLAY_NAME_MAX,
  BRAND_TAGLINE_MAX,
  normalizeHexColor,
} from "@/lib/brand/core";
import { saveBrandKitAction } from "../actions";

interface Fields {
  displayName: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
}

/**
 * The words and colours of one kit. The hex field is the source of truth and
 * the swatch is a picker for it: a native colour input cannot be empty, and
 * "no brand colour yet" is a real state the invoice renders differently.
 */
export function BrandKitForm({
  entityId,
  initial,
  fallbackName,
  canWrite,
}: {
  entityId: string | null;
  initial: Fields;
  fallbackName: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fields, setFields] = useState<Fields>(initial);
  const dirty =
    fields.displayName !== initial.displayName ||
    fields.tagline !== initial.tagline ||
    fields.primaryColor !== initial.primaryColor ||
    fields.accentColor !== initial.accentColor;

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function onSave() {
    startTransition(async () => {
      const result = await saveBrandKitAction({ entityId, ...fields });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Brand saved.");
      router.refresh();
    });
  }

  if (!canWrite) {
    return (
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <ReadOnly label="Business name" value={fields.displayName || `${fallbackName} (default)`} />
        <ReadOnly label="Tagline" value={fields.tagline || "None"} />
        <ReadOnly label="Primary color" value={fields.primaryColor || "Default"} mono />
        <ReadOnly label="Accent color" value={fields.accentColor || "Default"} mono />
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Only an owner can change these.
        </p>
      </dl>
    );
  }

  const idFor = (name: string) => `brand-${entityId ?? "business"}-${name}`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={idFor("name")}>Business name</Label>
          <Input
            id={idFor("name")}
            value={fields.displayName}
            maxLength={BRAND_DISPLAY_NAME_MAX}
            placeholder={fallbackName}
            onChange={(e) => set("displayName", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The name customers see. Leave blank to use {fallbackName}.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={idFor("tagline")}>Tagline</Label>
          <Input
            id={idFor("tagline")}
            value={fields.tagline}
            maxLength={BRAND_TAGLINE_MAX}
            placeholder="A line under the name, on documents"
            onChange={(e) => set("tagline", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Optional. Up to {BRAND_TAGLINE_MAX} characters.</p>
        </div>
        <ColorField
          id={idFor("primary")}
          label="Primary color"
          hint="Headings and rules on your documents. Blank keeps the default black."
          value={fields.primaryColor}
          onChange={(v) => set("primaryColor", v)}
        />
        <ColorField
          id={idFor("accent")}
          label="Accent color"
          hint="A second color for later: the website and highlights. Blank is fine."
          value={fields.accentColor}
          onChange={(v) => set("accentColor", v)}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={onSave} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {dirty && !pending && (
          <Button variant="ghost" size="sm" onClick={() => setFields(initial)}>
            Discard changes
          </Button>
        )}
      </div>
    </div>
  );
}

function ColorField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const normalized = normalizeHexColor(value);
  const invalid = value.trim() !== "" && normalized === null;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`Pick ${label.toLowerCase()}`}
          className="size-9 shrink-0 cursor-pointer rounded-lg border border-border bg-background p-1"
          value={normalized ?? "#9ca3af"}
          onChange={(e) => onChange(e.target.value)}
        />
        <Input
          id={id}
          value={value}
          placeholder="#1f6f5f"
          maxLength={9}
          className="font-mono"
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {value !== "" && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {invalid ? "Needs to be a hex value like #1f6f5f." : hint}
      </p>
    </div>
  );
}

function ReadOnly({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono" : undefined}>{value}</dd>
    </div>
  );
}
