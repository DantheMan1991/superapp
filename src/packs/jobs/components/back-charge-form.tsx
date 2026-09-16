"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Minus, Pencil, Plus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  raiseBackChargeAction,
  setBackChargeApplicationAction,
  setBackChargeVoidAction,
  updateBackChargeAction,
} from "../actions";
import { BACK_CHARGE_DESCRIPTION_MAX } from "../vocabulary";

const NONE = "__none__";

export interface BackChargeCodeOption {
  id: string;
  label: string;
}

export interface BackChargeClaimOption {
  id: string;
  label: string;
}

export interface EditableBackCharge {
  id: string;
  version: number;
  number: number;
  description: string;
  amount: string;
  incurredOn: string;
  costCodeId: string | null;
  warrantyClaimId: string | null;
  notes: string;
}

/**
 * A back-charge as the office raises it (ADR 0077): what the business paid
 * for that was the subcontractor's, how much, when, the cost code it landed
 * on, and the warranty claim it came from when it came from one. The same
 * dialog edits one, until it has been deducted on a billed application.
 */
export function BackChargeDialog({
  projectId,
  commitmentId,
  today,
  codes,
  claims,
  existing,
}: {
  projectId: string;
  commitmentId: string;
  today: string;
  codes: BackChargeCodeOption[];
  claims: BackChargeClaimOption[];
  existing?: EditableBackCharge;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [description, setDescription] = useState(existing?.description ?? "");
  const [amount, setAmount] = useState(existing?.amount ?? "");
  const [incurredOn, setIncurredOn] = useState(existing?.incurredOn ?? today);
  const [costCodeId, setCostCodeId] = useState(existing?.costCodeId ?? NONE);
  const [warrantyClaimId, setWarrantyClaimId] = useState(existing?.warrantyClaimId ?? NONE);
  const [notes, setNotes] = useState(existing?.notes ?? "");

  function save() {
    if (description.trim() === "" || amount.trim() === "") {
      toast.error("Say what was paid for and how much.");
      return;
    }
    startTransition(async () => {
      const fields = {
        projectId,
        commitmentId,
        description: description.trim(),
        amount: amount.trim(),
        incurredOn,
        costCodeId: costCodeId === NONE ? null : costCodeId,
        warrantyClaimId: warrantyClaimId === NONE ? null : warrantyClaimId,
        notes,
      };
      const result = existing
        ? await updateBackChargeAction({ ...fields, id: existing.id, version: existing.version })
        : await raiseBackChargeAction(fields);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(existing ? "Back-charge saved." : "Back-charge raised.");
      setOpen(false);
      if (!existing) {
        setDescription("");
        setAmount("");
        setIncurredOn(today);
        setCostCodeId(NONE);
        setWarrantyClaimId(NONE);
        setNotes("");
      }
      router.refresh();
    });
  }

  return (
    <>
      {existing ? (
        <Button variant="ghost" size="icon" aria-label={`Edit back-charge ${existing.number}`} onClick={() => setOpen(true)}>
          <Pencil className="size-4" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Raise a back-charge
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{existing ? `Back-charge ${existing.number}` : "Raise a back-charge"}</DialogTitle>
            <DialogDescription>
              Money you spent that was theirs to spend. It comes off their next application, not off the order: the subcontract still says what they
              agreed to do for what money.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bc-what">What you paid for</Label>
              <Input
                id="bc-what"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={BACK_CHARGE_DESCRIPTION_MAX}
                placeholder="Cleaned the site after them"
                autoFocus
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bc-amount">Amount</Label>
                <Input id="bc-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="800.00" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bc-on">Spent on</Label>
                <Input id="bc-on" type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bc-code">Cost code it landed on</Label>
                <Select value={costCodeId} onValueChange={setCostCodeId}>
                  <SelectTrigger id="bc-code">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No code</SelectItem>
                    {codes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bc-claim">From a warranty claim</Label>
                <Select value={warrantyClaimId} onValueChange={setWarrantyClaimId}>
                  <SelectTrigger id="bc-claim">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not from a claim</SelectItem>
                    {claims.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bc-notes">Notes</Label>
              <Textarea
                id="bc-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Told them on the 14th; they did not come back."
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending || description.trim() === "" || amount.trim() === ""}>
              {existing ? "Save" : "Raise"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Put one on the draft application, or take it back off. Nothing posts until the draft is approved. */
export function DeductBackChargeButton({
  projectId,
  commitmentId,
  id,
  number,
  subApplicationId,
  applicationNumber,
}: {
  projectId: string;
  commitmentId: string;
  id: string;
  number: number;
  /** The draft to put it on, or null to take it off the one it is on. */
  subApplicationId: string | null;
  applicationNumber: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const putting = subApplicationId !== null;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setBackChargeApplicationAction({ projectId, commitmentId, id, subApplicationId });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(putting ? `Back-charge ${number} comes off application ${applicationNumber}.` : `Back-charge ${number} taken off.`);
          router.refresh();
        })
      }
    >
      {putting ? (
        <>
          <Minus className="mr-1.5 size-4" /> Deduct on {applicationNumber}
        </>
      ) : (
        <>
          <Undo2 className="mr-1.5 size-4" /> Take off
        </>
      )}
    </Button>
  );
}

/** Drop one, with the reason, or put a dropped one back. Never available once it has been deducted. */
export function VoidBackChargeButton({
  projectId,
  commitmentId,
  id,
  number,
  isVoid,
}: {
  projectId: string;
  commitmentId: string;
  id: string;
  number: number;
  isVoid: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function run(next: boolean, why?: string) {
    startTransition(async () => {
      const result = await setBackChargeVoidAction({ projectId, commitmentId, id, isVoid: next, reason: why });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(next ? `Back-charge ${number} dropped.` : `Back-charge ${number} is owed again.`);
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  if (isVoid) {
    return (
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(false)}>
        <Undo2 className="mr-1.5 size-4" /> Charge it again
      </Button>
    );
  }
  return (
    <>
      <Button variant="ghost" size="icon" aria-label={`Drop back-charge ${number}`} disabled={pending} onClick={() => setOpen(true)}>
        <Ban className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Drop back-charge {number}?</DialogTitle>
            <DialogDescription>
              It stays on the order as a record — they will ask about it — and comes off whatever draft it was riding. You can charge it again later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="bc-why">Why</Label>
            <Textarea
              id="bc-why"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="They came back and did it."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => run(true, reason)} disabled={pending}>
              Drop it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
