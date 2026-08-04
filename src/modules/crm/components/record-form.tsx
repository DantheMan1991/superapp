"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { createRecordAction, updateRecordAction } from "../actions";
import { CustomFieldInputs } from "./custom-field-inputs";
import type { CustomValue } from "../core/custom-fields";
import type { RecordFormValues } from "../core/types";
import type { CrmFieldDef, PartyKind } from "@/db/schema";

const BASE = "/dashboard/m/crm";

/**
 * One form for both creating and editing, because the fields are identical and
 * two components would drift.
 *
 * THE VISIBILITY CONTROL IS OWNER-ONLY, and hiding it is a courtesy rather than
 * the control. RLS refuses the write either way — a staff member who set
 * `restricted` would fail the policy's WITH CHECK and be told the record
 * changed underneath them, which is true but unhelpful. Not offering the switch
 * is how they find that out before typing anything.
 */
export function RecordForm({
  mode,
  partyId,
  partyVersion,
  detailsVersion,
  initial,
  isOwner,
  fieldDefs = [],
  initialCustom = {},
}: {
  mode: "create" | "edit";
  partyId?: string;
  partyVersion?: number;
  detailsVersion?: number;
  initial: RecordFormValues;
  isOwner: boolean;
  fieldDefs?: CrmFieldDef[];
  initialCustom?: Record<string, unknown>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<RecordFormValues>(initial);
  const [custom, setCustom] = useState<Record<string, unknown>>(initialCustom);
  // Per-field messages from the server, cleared as soon as somebody edits the
  // field they belong to — a stale error beside a corrected value is worse than
  // no error at all.
  const [fieldIssues, setFieldIssues] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function setCustomValue(fieldId: string, value: CustomValue | undefined) {
    setCustom((c) => {
      const next = { ...c };
      if (value === undefined) delete next[fieldId];
      else next[fieldId] = value;
      return next;
    });
    setFieldIssues((i) => {
      if (!(fieldId in i)) return i;
      const next = { ...i };
      delete next[fieldId];
      return next;
    });
  }

  function set<K extends keyof RecordFormValues>(
    key: K,
    value: RecordFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  const isPerson = values.kind === "person";
  // A person may be named by their parts instead of a display name; an
  // organization has nothing else to be called.
  const named =
    values.displayName.trim().length > 0 ||
    (isPerson &&
      (values.givenName.trim().length > 0 ||
        values.familyName.trim().length > 0));

  function submit() {
    if (!named) {
      toast.error("Give the record a name");
      return;
    }

    startTransition(async () => {
      setFieldIssues({});
      const payload = {
        kind: values.kind,
        displayName: values.displayName.trim() || undefined,
        givenName: isPerson ? values.givenName.trim() || null : null,
        familyName: isPerson ? values.familyName.trim() || null : null,
        legalName: values.legalName.trim() || null,
        lifecycleStage: values.lifecycleStage.trim(),
        source: values.source.trim(),
        notes: values.notes,
        custom,
        ...(isOwner ? { visibility: values.visibility } : {}),
      };

      const result =
        mode === "create"
          ? await createRecordAction(payload)
          : await updateRecordAction({
              partyId: partyId!,
              partyVersion: partyVersion!,
              detailsVersion: detailsVersion!,
              ...payload,
            });

      if ("error" in result) {
        if (result.issues?.length) {
          setFieldIssues(
            Object.fromEntries(result.issues.map((i) => [i.fieldId, i.message])),
          );
        }
        toast.error(result.error);
        return;
      }

      if (mode === "create" && result.data) {
        toast.success("Record added");
        router.push(`${BASE}/records/${result.data.partyId}`);
      } else {
        toast.success("Saved");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="crm-kind">Type</Label>
          <Select
            value={values.kind}
            onValueChange={(v) => set("kind", v as PartyKind)}
          >
            <SelectTrigger id="crm-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organization">Company</SelectItem>
              <SelectItem value="person">Person</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="crm-display-name">
            {isPerson ? "Display name" : "Name"}
          </Label>
          <Input
            id="crm-display-name"
            value={values.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            // DESCRIPTIVE, NOT AN EXAMPLE. A placeholder naming a fictional
            // company is user-visible copy in a core module, and whichever
            // trade the fake name belongs to is the trade this product looks
            // like it is for — the §8 leak, in the place it does the most work.
            placeholder={
              isPerson ? "Built from the names below" : "Their business name"
            }
          />
        </div>
      </div>

      {isPerson && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="crm-given-name">First name</Label>
            <Input
              id="crm-given-name"
              value={values.givenName}
              onChange={(e) => set("givenName", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="crm-family-name">Last name</Label>
            <Input
              id="crm-family-name"
              value={values.familyName}
              onChange={(e) => set("familyName", e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="crm-legal-name">
            {isPerson ? "Formal name" : "Legal name"}
          </Label>
          <Input
            id="crm-legal-name"
            value={values.legalName}
            onChange={(e) => set("legalName", e.target.value)}
            placeholder={isPerson ? "" : "Registered name, if different"}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="crm-stage">Stage</Label>
          <Input
            id="crm-stage"
            value={values.lifecycleStage}
            onChange={(e) => set("lifecycleStage", e.target.value)}
            placeholder="Lead, active, dormant…"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="crm-source">Where they came from</Label>
        <Input
          id="crm-source"
          value={values.source}
          onChange={(e) => set("source", e.target.value)}
          placeholder="Referral, website, walk-in…"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="crm-notes">Notes</Label>
        <Textarea
          id="crm-notes"
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={5}
        />
      </div>

      <CustomFieldInputs
        defs={fieldDefs}
        values={custom}
        issues={fieldIssues}
        onChange={setCustomValue}
        disabled={pending}
      />

      {isOwner && (
        <div className="flex items-start justify-between gap-4 rounded-md border px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="crm-restricted">Restrict this record</Label>
            <p className="text-xs text-muted-foreground">
              Only owners see the stage, notes and connections. The name stays
              visible to staff, who can already see it in Accounting.
            </p>
          </div>
          <Switch
            id="crm-restricted"
            checked={values.visibility === "restricted"}
            onCheckedChange={(on) =>
              set("visibility", on ? "restricted" : "members")
            }
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          {mode === "create" ? "Add record" : "Save"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => router.push(mode === "create" ? BASE : `${BASE}/records/${partyId}`)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
