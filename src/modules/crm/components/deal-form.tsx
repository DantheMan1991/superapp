"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CrmFieldDef } from "@/db/schema";
import { createDealAction, updateDealAction } from "../deal-actions";
import { CustomFieldInputs } from "./custom-field-inputs";
import type { CustomValue } from "../core/custom-fields";

const BASE = "/dashboard/m/crm";

export interface DealFormValues {
  title: string;
  /** A STRING, not cents. `@/lib/money` owns the parse, server-side. */
  amount: string;
  expectedCloseOn: string;
}

/**
 * Create or edit a deal.
 *
 * THE AMOUNT IS SENT AS THE TYPED STRING and parsed once, on the server, by
 * `parseMoneyToCents`. Parsing here as well would be a second opinion about
 * what "1,234.5" means, and the two would eventually disagree — conventions §3
 * puts that logic in exactly one place and this form does not get to be a
 * second one.
 */
export function DealForm({
  mode,
  dealId,
  dealVersion,
  partyId,
  partyName,
  initial,
  fieldDefs = [],
  initialCustom = {},
}: {
  mode: "create" | "edit";
  dealId?: string;
  dealVersion?: number;
  partyId: string;
  partyName: string;
  initial: DealFormValues;
  fieldDefs?: CrmFieldDef[];
  initialCustom?: Record<string, unknown>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<DealFormValues>(initial);
  const [custom, setCustom] = useState<Record<string, unknown>>(initialCustom);
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

  function submit() {
    if (values.title.trim().length === 0) {
      toast.error("Give the deal a name");
      return;
    }

    startTransition(async () => {
      setFieldIssues({});
      const payload = {
        title: values.title.trim(),
        amount: values.amount.trim(),
        expectedCloseOn: values.expectedCloseOn || null,
        custom,
      };

      const result =
        mode === "create"
          ? await createDealAction({ partyId, ...payload })
          : await updateDealAction({
              dealId: dealId!,
              expectedVersion: dealVersion!,
              partyId,
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
        toast.success("Deal added");
        router.push(`${BASE}/deals/${result.data.dealId}`);
      } else {
        toast.success("Saved");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="crm-deal-title">What is it</Label>
        <Input
          id="crm-deal-title"
          value={values.title}
          onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
          placeholder={`Work for ${partyName}`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="crm-deal-amount">Amount</Label>
          <Input
            id="crm-deal-amount"
            inputMode="decimal"
            value={values.amount}
            onChange={(e) => setValues((v) => ({ ...v, amount: e.target.value }))}
            placeholder="Leave blank if not priced yet"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="crm-deal-close">Expected close</Label>
          <Input
            id="crm-deal-close"
            type="date"
            value={values.expectedCloseOn}
            onChange={(e) =>
              setValues((v) => ({ ...v, expectedCloseOn: e.target.value }))
            }
          />
        </div>
      </div>

      <CustomFieldInputs
        defs={fieldDefs}
        values={custom}
        issues={fieldIssues}
        onChange={setCustomValue}
        disabled={pending}
      />

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          {mode === "create" ? "Add deal" : "Save"}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            router.push(
              mode === "create" ? `${BASE}/records/${partyId}` : `${BASE}/deals/${dealId}`,
            )
          }
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
