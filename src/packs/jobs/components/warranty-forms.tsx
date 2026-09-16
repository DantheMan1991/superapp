"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Gavel, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  decideClaimAction,
  deleteClaimAction,
  recordClaimAction,
  scheduleClaimAction,
  setClaimDoneAction,
  setWarrantyPeriodAction,
  updateClaimAction,
} from "../actions";
import { WARRANTY_DECISIONS, WARRANTY_DECISION_LABELS, WARRANTY_MONTHS_MAX, type WarrantyDecision } from "../vocabulary";

const NONE = "__none__";

export interface PartyOption {
  id: string;
  name: string;
  /** A party on one of the job's orders — the likely trade — listed first. */
  onJob: boolean;
}

export interface CodeOption {
  id: string;
  label: string;
}

/**
 * The warranty period, on the job (ADR 0076): months from substantial
 * completion. Either half may be blank. Owner-only, because it is a term of
 * the agreement; the page hides the button from everybody else and the op
 * refuses anyway.
 */
export function WarrantyPeriodDialog({
  projectId,
  warrantyMonths,
  substantialCompletionOn,
}: {
  projectId: string;
  warrantyMonths: number | null;
  substantialCompletionOn: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [months, setMonths] = useState(warrantyMonths === null ? "" : String(warrantyMonths));
  const [completion, setCompletion] = useState(substantialCompletionOn ?? "");
  const isSet = warrantyMonths !== null || substantialCompletionOn !== null;

  function save() {
    startTransition(async () => {
      const result = await setWarrantyPeriodAction({ projectId, warrantyMonths: months.trim(), substantialCompletionOn: completion });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(months.trim() === "" && completion === "" ? "Period cleared." : "Period saved.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="mr-1.5 size-4" /> {isSet ? "Change the period" : "Set the period"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>The warranty period</DialogTitle>
            <DialogDescription>How long you warrant the work, from the day it was substantially complete. The end date is worked out from the two.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wp-months">Warranty, in months</Label>
              <Input
                id="wp-months"
                type="number"
                inputMode="numeric"
                min={1}
                max={WARRANTY_MONTHS_MAX}
                step={1}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                placeholder="12"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wp-completion">Substantial completion</Label>
              <Input id="wp-completion" type="date" value={completion} onChange={(e) => setCompletion(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export interface EditableClaim {
  id: string;
  version: number;
  number: number;
  title: string;
  location: string;
  reportedOn: string;
  reportedBy: string;
  partyId: string | null;
  costCodeId: string | null;
  notes: string;
}

/**
 * A claim as the call comes in: what is wrong, where, when and by whom, the
 * trade you think it belongs to, the cost code the fix is charged under.
 * Recording one raises a Work item at once — somebody has to go and look —
 * with the day to look by when you have one. The same dialog edits a claim;
 * its Work item's title follows.
 */
export function ClaimDialog({
  projectId,
  today,
  parties,
  codes,
  existing,
}: {
  projectId: string;
  today: string;
  parties: PartyOption[];
  codes: CodeOption[];
  existing?: EditableClaim;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [reportedOn, setReportedOn] = useState(existing?.reportedOn ?? today);
  const [reportedBy, setReportedBy] = useState(existing?.reportedBy ?? "");
  const [partyId, setPartyId] = useState(existing?.partyId ?? NONE);
  const [costCodeId, setCostCodeId] = useState(existing?.costCodeId ?? NONE);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [dueOn, setDueOn] = useState("");
  const onJob = parties.filter((p) => p.onJob);
  const others = parties.filter((p) => !p.onJob);

  function save() {
    if (title.trim() === "") {
      toast.error("Say what is wrong.");
      return;
    }
    startTransition(async () => {
      const fields = {
        projectId,
        title: title.trim(),
        location,
        reportedOn,
        reportedBy,
        partyId: partyId === NONE ? null : partyId,
        costCodeId: costCodeId === NONE ? null : costCodeId,
        notes,
      };
      const result = existing
        ? await updateClaimAction({ ...fields, id: existing.id, version: existing.version })
        : await recordClaimAction({ ...fields, dueOn });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(existing ? "Claim saved." : "Claim recorded, and the work raised.");
      setOpen(false);
      if (!existing) {
        setTitle("");
        setLocation("");
        setReportedOn(today);
        setReportedBy("");
        setPartyId(NONE);
        setCostCodeId(NONE);
        setNotes("");
        setDueOn("");
      }
      router.refresh();
    });
  }

  return (
    <>
      {existing ? (
        <Button variant="ghost" size="icon" aria-label={`Edit claim ${existing.number}`} onClick={() => setOpen(true)}>
          <Pencil className="size-4" />
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Record a claim
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{existing ? `Claim ${existing.number}` : "Record a claim"}</DialogTitle>
            <DialogDescription>
              {existing
                ? "The call as recorded. The work item's title follows what you save here."
                : "The call as it comes in. Recording it raises a work item to go and look, whatever the decision turns out to be."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cl-title">What is wrong</Label>
              <Input id="cl-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="Drip under the kitchen sink" autoFocus />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cl-location">Where</Label>
                <Input id="cl-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} placeholder="Kitchen" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cl-by">Reported by</Label>
                <Input id="cl-by" value={reportedBy} onChange={(e) => setReportedBy(e.target.value)} maxLength={200} placeholder="The owner" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cl-reported">Reported on</Label>
                <Input id="cl-reported" type="date" value={reportedOn} onChange={(e) => setReportedOn(e.target.value)} />
              </div>
              {!existing && (
                <div className="space-y-1.5">
                  <Label htmlFor="cl-due">Look at it by</Label>
                  <Input id="cl-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cl-party">Trade responsible</Label>
                <Select value={partyId} onValueChange={setPartyId}>
                  <SelectTrigger id="cl-party">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not named yet</SelectItem>
                    {onJob.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>On this job</SelectLabel>
                        {onJob.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {others.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>{onJob.length > 0 ? "Everybody else" : "Parties"}</SelectLabel>
                        {others.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cl-code">Cost code for the fix</Label>
                <Select value={costCodeId} onValueChange={setCostCodeId}>
                  <SelectTrigger id="cl-code">
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cl-notes">Notes</Label>
              <Textarea id="cl-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={4000} placeholder="What they said, what you saw." />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending || title.trim() === ""}>
              {existing ? "Save" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The decision: covered, not covered, or not yet. Not covered closes the
 * work item — going to look was the work — and the claim's row says the
 * rest; covered keeps it open for the fix.
 */
export function ClaimDecisionDialog({
  projectId,
  claim,
  today,
}: {
  projectId: string;
  claim: { id: string; number: number; decision: WarrantyDecision; decisionNote: string; decidedOn: string | null };
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [decision, setDecision] = useState<WarrantyDecision>(claim.decision);
  const [decidedOn, setDecidedOn] = useState(claim.decidedOn ?? today);
  const [note, setNote] = useState(claim.decisionNote);

  function save() {
    startTransition(async () => {
      const result = await decideClaimAction({ projectId, id: claim.id, decision, note, decidedOn: decision === "pending" ? "" : decidedOn });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(decision === "pending" ? "Left undecided." : `Claim ${claim.number}: ${WARRANTY_DECISION_LABELS[decision].toLowerCase()}.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Gavel className="mr-1.5 size-4" /> {claim.decision === "pending" ? "Decide" : "Decision"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Claim {claim.number} — does the warranty cover it?</DialogTitle>
            <DialogDescription>Not covered closes the work item; the claim stays on record with your reason. Covered leaves the work open for the fix.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cd-decision">Decision</Label>
                <Select value={decision} onValueChange={(v) => setDecision(v as WarrantyDecision)}>
                  <SelectTrigger id="cd-decision">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WARRANTY_DECISIONS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {WARRANTY_DECISION_LABELS[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cd-on">Decided on</Label>
                <Input id="cd-on" type="date" value={decidedOn} onChange={(e) => setDecidedOn(e.target.value)} disabled={decision === "pending"} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cd-note">Why</Label>
              <Textarea id="cd-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} placeholder="Settlement crack under a quarter inch — within tolerance." />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The day somebody will be there: the work item's due date, which the digest chases. */
export function ClaimScheduleDialog({ projectId, claim }: { projectId: string; claim: { id: string; number: number; dueOn: string | null } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [dueOn, setDueOn] = useState(claim.dueOn ?? "");

  function save(next: string) {
    startTransition(async () => {
      const result = await scheduleClaimAction({ projectId, id: claim.id, dueOn: next });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(next ? `Claim ${claim.number} scheduled for ${next}.` : "Day cleared.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <CalendarClock className="mr-1.5 size-4" /> {claim.dueOn ?? "Schedule"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Claim {claim.number} — when</DialogTitle>
            <DialogDescription>The day somebody will be there. It goes on the work item, so Work and the digest carry it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cs-due">Day</Label>
            <Input id="cs-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </div>
          <DialogFooter className="flex-row items-center justify-between sm:justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={() => save("")} disabled={pending || !claim.dueOn}>
              Clear the day
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" onClick={() => save(dueOn)} disabled={pending || dueOn === ""}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Tick the claim done, or open it again — the work item's own state. */
export function ClaimDoneCheckbox({ projectId, id, number, done, disabled }: { projectId: string; id: string; number: number; done: boolean; disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Checkbox
      aria-label={`Claim ${number} done`}
      checked={done}
      disabled={disabled || pending}
      onCheckedChange={(v) =>
        startTransition(async () => {
          const result = await setClaimDoneAction({ projectId, id, done: v === true });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          router.refresh();
        })
      }
    />
  );
}

/** Owners only: a claim recorded by mistake. Its work item stays in Work, unlinked. */
export function DeleteClaimButton({ projectId, id, number }: { projectId: string; id: string; number: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Remove claim ${number}`}
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Remove claim ${number}? Its work item stays in Work.`)) return;
        startTransition(async () => {
          const result = await deleteClaimAction({ projectId, id });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(`Claim ${number} removed.`);
          router.refresh();
        });
      }}
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
