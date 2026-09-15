"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { createContractAction, updateContractAction } from "../actions";
import {
  BILLING_METHODS,
  BILLING_METHOD_LABELS,
  CONTRACT_ROLES,
  CONTRACT_STATUSES,
  CONTRACT_STATUS_LABELS,
  ROLE_LABELS,
  VALUED_CONTRACT_STATUSES,
  slugLabel,
  isCostPlusMethod,
  isFixedValueMethod,
  isTimeAndMaterialsMethod,
  isUnitPriceMethod,
} from "../vocabulary";
import { ppmToPercentString } from "../billing-math";

const NONE = "__none__";

/**
 * Add an agreement to a project.
 *
 * **THE KINDS COME FROM THE PROFILE, THE BILLING METHODS FROM THE PACK**, and
 * the asymmetry is deliberate. A kind is a word — Concept Design, New Home, AIA
 * — and a pack that shipped that list would know its industry. A billing method
 * is a *sum*, and the pack has to implement one before it can honestly offer it,
 * so that list is closed and lives here.
 *
 * **The value box takes what people type.** `182,500`, `$182500`, `182500.00`
 * all mean the same thing; the action turns it into cents at the boundary, and
 * nothing below ever sees a decimal.
 */
export interface EditableContract {
  id: string;
  version: number;
  kind: string;
  name: string;
  counterpartyPartyId: string | null;
  role: string;
  billingMethod: string;
  valueCents: number | null;
  feePpm?: number | null;
  feeCents?: number | null;
  gmaxCents?: number | null;
  /** Time and materials: one rate for everybody, cents per hour; null = each person's rate from Time. */
  laborRateCents?: number | null;
  /** Time and materials: an application has issued, so the flat rate is fixed. */
  rateLocked?: boolean;
  status: string;
  signedOn: string | null;
  notes: string;
}

export function ContractForm({
  projectId,
  parties,
  contractKinds,
  clientWord,
  existing,
  trigger,
}: {
  projectId: string;
  parties: Array<{ id: string; name: string }>;
  contractKinds: string[];
  clientWord: string;
  /** When set, edits this contract instead of creating one. */
  existing?: EditableContract;
  trigger?: ReactNode;
}) {
  const editing = existing !== undefined;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState(existing?.kind ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [counterparty, setCounterparty] = useState(
    existing?.counterpartyPartyId ?? NONE,
  );
  const [role, setRole] = useState<string>(existing?.role ?? "prime");
  const [billingMethod, setBillingMethod] = useState<string>(
    existing?.billingMethod ?? "fixed_price",
  );
  /**
   * Cents back into something a person edits. `1250000` reads as `12500.00`, and
   * the action parses whatever comes back — so a value that is never touched
   * survives a round trip unchanged, which is the property that matters.
   */
  const [value, setValue] = useState(
    existing?.valueCents != null ? (existing.valueCents / 100).toFixed(2) : "",
  );
  const [feePercent, setFeePercent] = useState(
    existing?.feePpm != null ? ppmToPercentString(existing.feePpm) : "",
  );
  const [feeFixed, setFeeFixed] = useState(
    existing?.feeCents != null ? (existing.feeCents / 100).toFixed(2) : "",
  );
  const [gmax, setGmax] = useState(
    existing?.gmaxCents != null ? (existing.gmaxCents / 100).toFixed(2) : "",
  );
  const [laborRate, setLaborRate] = useState(
    existing?.laborRateCents != null ? (existing.laborRateCents / 100).toFixed(2) : "",
  );
  const [status, setStatus] = useState<string>(existing?.status ?? "proposed");
  const [signedOn, setSignedOn] = useState(existing?.signedOn ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const ready = kind.trim() !== "";
  const tm = isTimeAndMaterialsMethod(billingMethod);
  const rateLocked = editing && existing.rateLocked === true;
  /**
   * **A SIGNED VALUE IS LOCKED**, here as well as in `updateContract`, so the
   * box says why before a save can be refused. Once the agreement counts, its
   * value is the ORIGINAL half of *original + approved changes = revised*, and
   * the way it moves is a change order. A signed contract whose value was never
   * recorded may still have it filled in once — that is entry, not revision.
   */
  const valueLocked =
    editing &&
    existing.valueCents !== null &&
    (VALUED_CONTRACT_STATUSES as readonly string[]).includes(existing.status);

  function submit() {
    startTransition(async () => {
      const fields = {
        projectId,
        kind: kind.trim(),
        name: name.trim(),
        counterpartyPartyId: counterparty === NONE ? "" : counterparty,
        role,
        billingMethod,
        valueCents: value,
        feePpm: feePercent,
        feeCents: feeFixed,
        gmaxCents: gmax,
        laborRateCents: laborRate,
        status,
        signedOn,
        notes: notes.trim(),
      };
      // The version goes with the edit; see ProjectForm for why.
      const result = editing
        ? await updateContractAction({
            ...fields,
            id: existing.id,
            version: existing.version,
          })
        : await createContractAction(fields);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Contract saved" : "Contract added");
      setOpen(false);
      if (editing) {
        router.refresh();
        return;
      }
      setKind("");
      setName("");
      setCounterparty(NONE);
      setValue("");
      setSignedOn("");
      setNotes("");
      /*
       * **STATUS RESETS, AND IT HAS TO.** Found by adding two contracts in a
       * row: the dialog is one component, so anything not cleared here carries
       * into the next one — and a second agreement silently inheriting
       * `Complete` from the first records unsigned work as money the business is
       * owed. Role and billing method are reset for the same predictability,
       * even though neither moves a number: a form that remembers some fields
       * and forgets others is worse than one that forgets all of them.
       */
      setStatus("proposed");
      setRole("prime");
      setBillingMethod("fixed_price");
      router.refresh();
    });
  }

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Add contract
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit" : "New"} contract</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="contract-kind">Kind</Label>
              {contractKinds.length > 0 ? (
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger className="w-full" id="contract-kind">
                    <SelectValue placeholder="Which agreement is this" />
                  </SelectTrigger>
                  <SelectContent>
                    {contractKinds.map((k) => (
                      <SelectItem key={k} value={k}>
                        {slugLabel(k)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="contract-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  placeholder="new_home, concept_design, aia…"
                  maxLength={63}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contract-name">Name</Label>
              <Input
                id="contract-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional, when the kind is not enough"
                maxLength={200}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contract-role">Who holds it</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="w-full" id="contract-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contract-party">
                {/* The owner on a prime contract; the GC when we are the sub. */}
                {role === "subcontract" ? "General contractor" : clientWord}
              </Label>
              <Select value={counterparty} onValueChange={setCounterparty}>
                <SelectTrigger className="w-full" id="contract-party">
                  <SelectValue placeholder="Who it is with" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nobody yet</SelectItem>
                  {parties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="contract-value">Value</Label>
                <Input
                  id="contract-value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="182,500"
                  inputMode="decimal"
                  disabled={valueLocked}
                />
                {valueLocked && (
                  <p className="text-xs text-muted-foreground">
                    Signed. Change the value with a change order.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contract-signed">Signed</Label>
                <Input
                  id="contract-signed"
                  type="date"
                  value={signedOn}
                  onChange={(e) => setSignedOn(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contract-billing">Billed by</Label>
              <Select value={billingMethod} onValueChange={setBillingMethod}>
                <SelectTrigger className="w-full" id="contract-billing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {BILLING_METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {tm
                  ? "Billed as the hours Time has approved on the job, at each person's charged-out rate or one rate for everybody, plus the job's other cost with the markup below."
                  : isCostPlusMethod(billingMethod)
                    ? "Billed as what the job has cost, plus the fee below."
                    : isUnitPriceMethod(billingMethod)
                    ? "Billed by the quantities installed at their unit prices, against a schedule of items on the contract's page. The value is the estimate the schedule adds up to."
                      : isFixedValueMethod(billingMethod)
                      ? "Billed against a schedule of values on the contract's page."
                    : "Recorded now; this method is not billed here yet."}
              </p>
            </div>

            {(isCostPlusMethod(billingMethod) || tm) && (
              /*
                THE TERMS OF A COST-PLUS OR TIME-AND-MATERIALS AGREEMENT. A fee
                (a markup, on T&M) as a share of cost, a fixed fee, or both; a
                maximum (the not-to-exceed, on T&M) the sum never passes; and,
                on T&M, one labour rate for everybody in place of each person's
                rate from Time. Shown only when the method asks for them,
                because a box that means nothing on a fixed-price contract is a
                box somebody fills in.
              */
              <div className={"grid gap-3 " + (tm ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
                {tm && (
                  <div className="space-y-1.5">
                    <Label htmlFor="contract-labor-rate">Labour rate, everybody</Label>
                    <Input
                      id="contract-labor-rate"
                      value={laborRate}
                      onChange={(e) => setLaborRate(e.target.value)}
                      placeholder="Each person's rate from Time"
                      inputMode="decimal"
                      disabled={rateLocked}
                    />
                    <p className="text-xs text-muted-foreground">
                      {rateLocked
                        ? "Fixed once an application has issued."
                        : "Per hour. Blank bills each person at their charged-out rate in Time."}
                    </p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="contract-fee-percent">{tm ? "Markup % on cost" : "Fee % of cost"}</Label>
                  <Input
                    id="contract-fee-percent"
                    value={feePercent}
                    onChange={(e) => setFeePercent(e.target.value)}
                    placeholder="15"
                    inputMode="decimal"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contract-fee-fixed">Fixed fee</Label>
                  <Input
                    id="contract-fee-fixed"
                    value={feeFixed}
                    onChange={(e) => setFeeFixed(e.target.value)}
                    placeholder="none"
                    inputMode="decimal"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contract-gmax">{tm ? "Not to exceed" : "Guaranteed maximum"}</Label>
                  <Input
                    id="contract-gmax"
                    value={gmax}
                    onChange={(e) => setGmax(e.target.value)}
                    placeholder="none"
                    inputMode="decimal"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="contract-status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full" id="contract-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {CONTRACT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only signed and complete contracts count toward what the job is
                worth.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contract-notes">Notes</Label>
              <Textarea
                id="contract-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !ready}>
              {pending
                ? editing
                  ? "Saving…"
                  : "Adding…"
                : editing
                  ? "Save"
                  : "Add contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
