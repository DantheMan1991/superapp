"use client";

import { useState, useTransition } from "react";
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
import { createContractAction } from "../actions";
import {
  BILLING_METHODS,
  BILLING_METHOD_LABELS,
  CONTRACT_ROLES,
  CONTRACT_STATUSES,
  CONTRACT_STATUS_LABELS,
  ROLE_LABELS,
  slugLabel,
} from "../vocabulary";

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
export function ContractForm({
  projectId,
  parties,
  contractKinds,
  clientWord,
}: {
  projectId: string;
  parties: Array<{ id: string; name: string }>;
  contractKinds: string[];
  clientWord: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState("");
  const [name, setName] = useState("");
  const [counterparty, setCounterparty] = useState(NONE);
  const [role, setRole] = useState<string>("prime");
  const [billingMethod, setBillingMethod] = useState<string>("fixed_price");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<string>("proposed");
  const [signedOn, setSignedOn] = useState("");
  const [notes, setNotes] = useState("");

  const ready = kind.trim() !== "";

  function submit() {
    startTransition(async () => {
      const result = await createContractAction({
        projectId,
        kind: kind.trim(),
        name: name.trim(),
        counterpartyPartyId: counterparty === NONE ? "" : counterparty,
        role,
        billingMethod,
        valueCents: value,
        status,
        signedOn,
        notes: notes.trim(),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Contract added");
      setOpen(false);
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
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> Add contract
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New contract</DialogTitle>
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
                />
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
                Recorded now, used when billing is built.
              </p>
            </div>

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
              {pending ? "Adding…" : "Add contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
