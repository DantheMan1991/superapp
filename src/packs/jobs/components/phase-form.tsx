"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { createPhaseAction, deletePhaseAction, updatePhaseAction } from "../actions";
import { earliestStart } from "../schedule-math";
import { PHASE_KINDS, PHASE_KIND_LABELS, PHASE_STATUSES, PHASE_STATUS_LABELS } from "../vocabulary";

const NONE = "__none__";

export interface EditablePhase {
  id: string;
  version: number;
  name: string;
  kind: string;
  startOn: string;
  endOn: string;
  predecessorId: string | null;
  lagDays: number;
  partyId: string | null;
  costCodeId: string | null;
  status: string;
  notes: string;
}

export interface PhaseOption {
  id: string;
  name: string;
  endOn: string;
}

/**
 * A phase of the job's schedule: what, when, after what, who (ADR 0071). One
 * dialog adds and edits; the dates are the calendar item's and the rest is
 * the pack's. Moving a phase later pushes what follows it, and the toast
 * says how many moved.
 */
export function PhaseForm({
  projectId,
  parties,
  codes,
  others,
  existing,
  trigger,
}: {
  projectId: string;
  parties: Array<{ id: string; name: string }>;
  codes: Array<{ id: string; label: string }>;
  /** The job's other phases, as possible predecessors. */
  others: PhaseOption[];
  existing?: EditablePhase;
  trigger?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(existing?.name ?? "");
  const [kind, setKind] = useState(existing?.kind ?? "phase");
  const [startOn, setStartOn] = useState(existing?.startOn ?? "");
  const [endOn, setEndOn] = useState(existing?.endOn ?? "");
  const [predecessorId, setPredecessorId] = useState(existing?.predecessorId ?? NONE);
  const [lagDays, setLagDays] = useState(existing ? String(existing.lagDays) : "0");
  const [partyId, setPartyId] = useState(existing?.partyId ?? NONE);
  const [costCodeId, setCostCodeId] = useState(existing?.costCodeId ?? NONE);
  const [status, setStatus] = useState(existing?.status ?? "planned");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const candidates = others.filter((o) => o.id !== existing?.id);
  const predecessor = candidates.find((o) => o.id === predecessorId) ?? null;
  const lag = Number.parseInt(lagDays, 10);
  const earliest = predecessor && Number.isInteger(lag) ? earliestStart(predecessor.endOn, lag) : null;
  const tooEarly = earliest !== null && startOn !== "" && startOn < earliest;

  function submit() {
    startTransition(async () => {
      const payload = {
        projectId,
        name: name.trim(),
        kind,
        startOn,
        endOn: kind === "milestone" ? startOn : endOn || startOn,
        predecessorId: predecessorId === NONE ? "" : predecessorId,
        lagDays: Number.isInteger(lag) ? lag : 0,
        partyId: partyId === NONE ? "" : partyId,
        costCodeId: costCodeId === NONE ? "" : costCodeId,
        status,
        notes: notes.trim(),
      };
      const result = existing
        ? await updatePhaseAction({ ...payload, id: existing.id, version: existing.version })
        : await createPhaseAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const moved = "moved" in result ? result.moved : 0;
      toast.success(
        existing
          ? moved > 0
            ? `Phase saved — ${moved} later ${moved === 1 ? "phase" : "phases"} moved with it`
            : "Phase saved"
          : "Phase added",
      );
      setOpen(false);
      if (!existing) {
        // The form is one instance reused for every add: everything goes back to blank, or the next phase inherits the last one's crew.
        setName("");
        setKind("phase");
        setStartOn("");
        setEndOn("");
        setPredecessorId(NONE);
        setLagDays("0");
        setPartyId(NONE);
        setCostCodeId(NONE);
        setStatus("planned");
        setNotes("");
      }
      router.refresh();
    });
  }

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : existing ? (
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
          <Pencil className="size-4" />
          <span className="sr-only">Edit {existing.name}</span>
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Add phase
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{existing ? existing.name : "Add a phase"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
              <div className="space-y-1.5">
                <Label htmlFor="ph-name">Phase</Label>
                <Input id="ph-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Framing" maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ph-kind">Kind</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger className="w-full" id="ph-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PHASE_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {PHASE_KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ph-start">{kind === "milestone" ? "On" : "Starts"}</Label>
                <Input id="ph-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
              </div>
              {kind !== "milestone" && (
                <div className="space-y-1.5">
                  <Label htmlFor="ph-end">Ends</Label>
                  <Input id="ph-end" type="date" value={endOn} min={startOn || undefined} onChange={(e) => setEndOn(e.target.value)} />
                  <p className="text-xs text-muted-foreground">The last day on site; blank is the one day.</p>
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <div className="space-y-1.5">
                <Label htmlFor="ph-after">Follows</Label>
                <Select value={predecessorId} onValueChange={setPredecessorId}>
                  <SelectTrigger className="w-full" id="ph-after">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nothing in particular</SelectItem>
                    {candidates.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name} · to {o.endOn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ph-lag">Lag, days</Label>
                <Input id="ph-lag" value={lagDays} onChange={(e) => setLagDays(e.target.value)} inputMode="numeric" disabled={predecessorId === NONE} />
              </div>
            </div>
            {predecessor && (
              <p className={`text-xs ${tooEarly ? "text-destructive" : "text-muted-foreground"}`}>
                {tooEarly
                  ? `Cannot start before ${earliest}: ${predecessor.name} runs to ${predecessor.endOn}.`
                  : `May start from ${earliest}, the day after ${predecessor.name}${lag !== 0 ? ` plus ${lag} days` : ""}. Moving ${predecessor.name} later moves this with it.`}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ph-who">Who</Label>
                <Select value={partyId} onValueChange={setPartyId}>
                  <SelectTrigger className="w-full" id="ph-who">
                    <SelectValue />
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
              <div className="space-y-1.5">
                <Label htmlFor="ph-code">Cost code</Label>
                <Select value={costCodeId} onValueChange={setCostCodeId}>
                  <SelectTrigger className="w-full" id="ph-code">
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
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="ph-status">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-full" id="ph-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PHASE_STATUSES.map((st) => (
                      <SelectItem key={st} value={st}>
                        {PHASE_STATUS_LABELS[st]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ph-notes">Notes</Label>
                <Textarea id="ph-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder="Inspection booked for the Thursday." />
              </div>
            </div>
          </div>
          <DialogFooter className="flex-row items-center justify-between sm:justify-between">
            {existing ? <DeletePhaseButton projectId={projectId} phase={existing} onDone={() => setOpen(false)} /> : <span />}
            <Button onClick={submit} disabled={pending || name.trim() === "" || startOn === "" || tooEarly}>
              {pending ? "Saving…" : existing ? "Save" : "Add phase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeletePhaseButton({ projectId, phase, onDone }: { projectId: string; phase: EditablePhase; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setArmed(true)}>
        <Trash2 className="mr-1.5 size-4" /> Remove
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await deletePhaseAction({ id: phase.id, projectId });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success("Phase removed — what followed it now follows what it followed");
          onDone();
          router.refresh();
        })
      }
    >
      {pending ? "Removing…" : `Remove ${phase.name}`}
    </Button>
  );
}
