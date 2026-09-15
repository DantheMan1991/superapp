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
import { RecordPhotos, type RecordFile, type RecordPhoto } from "@/modules/documents/components/record-photos";
import {
  askForWaiverAction,
  attachWaiverDocumentAction,
  attachWaiverFileAction,
  attachWaiverPhotoAction,
  createLienWaiverAction,
  detachWaiverPhotoAction,
  setWaiverPhotoPrimaryAction,
  updateLienWaiverAction,
} from "../actions";
import {
  LIEN_WAIVER_KINDS,
  LIEN_WAIVER_KIND_LABELS,
  LIEN_WAIVER_STATUSES,
  LIEN_WAIVER_STATUS_LABELS,
} from "../vocabulary";

const NONE = "__none__";

export interface EditableLienWaiver {
  id: string;
  version: number;
  partyId: string;
  subApplicationId: string | null;
  kind: string;
  throughDate: string;
  amountCents: number;
  status: string;
  requestedOn: string | null;
  receivedOn: string | null;
  signedBy: string;
  reference: string;
  notes: string;
}

/** Today as the `date` input wants it, in the person's own timezone. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Record a lien waiver on an order (ADR 0066): who gave it, of which kind,
 * through which date, for how much, and whether it has arrived. The words on
 * the form are the state's, not ours; the signed copy is attached as photos
 * once the record exists.
 *
 * **KIND, THROUGH AND STATUS ARE THE WHOLE POINT.** A conditional waiver comes
 * with the application; an unconditional one after the money went out, and
 * is the one the owner's bank wants. `Received` fills today into the date
 * box; the action refuses a received waiver with no date.
 */
export function LienWaiverForm({
  projectId,
  commitmentId,
  commitmentLabel,
  defaultPartyId,
  parties,
  applications,
  documentsOn,
  tenantId,
  canPhoto,
  photos = [],
  files = [],
  existing,
  trigger,
}: {
  projectId: string;
  commitmentId: string;
  commitmentLabel: string;
  /** The order's party: who a waiver usually comes from. */
  defaultPartyId: string;
  parties: Array<{ id: string; name: string }>;
  /** The order's BILLED applications, for `Covers`. */
  applications: Array<{ id: string; label: string }>;
  documentsOn: boolean;
  tenantId: string;
  canPhoto: boolean;
  photos?: RecordPhoto[];
  files?: RecordFile[];
  existing?: EditableLienWaiver;
  trigger?: ReactNode;
}) {
  const editing = existing !== undefined;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [partyId, setPartyId] = useState(existing?.partyId ?? defaultPartyId);
  const [kind, setKind] = useState(existing?.kind ?? "unconditional_progress");
  const [throughDate, setThroughDate] = useState(existing?.throughDate ?? "");
  const [amount, setAmount] = useState(
    existing && existing.amountCents !== 0 ? (existing.amountCents / 100).toFixed(2) : "",
  );
  const [application, setApplication] = useState(existing?.subApplicationId ?? NONE);
  const [status, setStatus] = useState(existing?.status ?? "received");
  const [requestedOn, setRequestedOn] = useState(existing?.requestedOn ?? "");
  const [receivedOn, setReceivedOn] = useState(existing?.receivedOn ?? (existing ? "" : today()));
  const [signedBy, setSignedBy] = useState(existing?.signedBy ?? "");
  const [reference, setReference] = useState(existing?.reference ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const ready = partyId !== "" && throughDate !== "";

  function changeStatus(next: string) {
    setStatus(next);
    if (next === "received" && receivedOn === "") setReceivedOn(today());
  }

  /** Picking an application fills the through date and the amount from it, unless typed already. */
  function changeApplication(next: string) {
    setApplication(next);
  }

  function submit() {
    startTransition(async () => {
      const payload = {
        projectId,
        partyId,
        commitmentId,
        subApplicationId: application === NONE ? "" : application,
        kind,
        throughDate,
        amountCents: amount,
        status,
        requestedOn,
        receivedOn: status === "received" ? receivedOn : status === "requested" ? "" : receivedOn,
        signedBy: signedBy.trim(),
        reference: reference.trim(),
        notes: notes.trim(),
      };
      const result = editing
        ? await updateLienWaiverAction({ ...payload, id: existing.id, version: existing.version })
        : await createLienWaiverAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Waiver saved" : "Waiver recorded");
      setOpen(false);
      if (!editing) {
        setKind("unconditional_progress");
        setThroughDate("");
        setAmount("");
        setApplication(NONE);
        setStatus("received");
        setRequestedOn("");
        setReceivedOn(today());
        setSignedBy("");
        setReference("");
        setNotes("");
      }
      router.refresh();
    });
  }

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Record waiver
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit lien waiver" : "Record a lien waiver"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>On</Label>
              <p className="text-sm">
                {commitmentLabel}
                <span className="block text-xs text-muted-foreground">
                  A waiver stays on the order it was recorded against.
                </span>
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="lw-party">From</Label>
                <Select value={partyId} onValueChange={setPartyId}>
                  <SelectTrigger className="w-full" id="lw-party">
                    <SelectValue placeholder="Who gives up the lien right" />
                  </SelectTrigger>
                  <SelectContent>
                    {parties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Usually the subcontractor. A supplier of theirs may give one on this order too.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lw-kind">Kind</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger className="w-full" id="lw-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIEN_WAIVER_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {LIEN_WAIVER_KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Conditional comes with the application; unconditional after the money went out.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="lw-through">Through</Label>
                <Input
                  id="lw-through"
                  type="date"
                  value={throughDate}
                  onChange={(e) => setThroughDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lw-amount">Amount</Label>
                <Input
                  id="lw-amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="As the form states it"
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lw-application">Covers</Label>
                <Select value={application} onValueChange={changeApplication}>
                  <SelectTrigger className="w-full" id="lw-application">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Work through the date</SelectItem>
                    {applications.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="lw-status">Status</Label>
                <Select value={status} onValueChange={changeStatus}>
                  <SelectTrigger className="w-full" id="lw-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIEN_WAIVER_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {LIEN_WAIVER_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lw-requested">Requested</Label>
                <Input
                  id="lw-requested"
                  type="date"
                  value={requestedOn}
                  onChange={(e) => setRequestedOn(e.target.value)}
                />
              </div>
              {status === "received" && (
                <div className="space-y-1.5">
                  <Label htmlFor="lw-received">Received</Label>
                  <Input
                    id="lw-received"
                    type="date"
                    value={receivedOn}
                    onChange={(e) => setReceivedOn(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="lw-signed">Signed by</Label>
                <Input
                  id="lw-signed"
                  value={signedBy}
                  onChange={(e) => setSignedBy(e.target.value)}
                  placeholder="As written on the form"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lw-reference">Their reference</Label>
                <Input
                  id="lw-reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Optional"
                  maxLength={80}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lw-notes">Notes</Label>
              <Textarea
                id="lw-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Exceptions the form lists, disputed amounts"
              />
            </div>

            {editing && (
              <div className="space-y-1.5 rounded-lg border border-border/60 p-3">
                <Label>Signed copy</Label>
                {documentsOn ? (
                  <RecordPhotos
                    entityId={existing.id}
                    tenantId={tenantId}
                    photos={photos}
                    files={files}
                    canEdit={canPhoto}
                    subject="waiver"
                    attachAction={attachWaiverPhotoAction}
                    setPrimaryAction={setWaiverPhotoPrimaryAction}
                    detachAction={detachWaiverPhotoAction}
                    attachFileAction={attachWaiverFileAction}
                    attachExistingAction={attachWaiverDocumentAction}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    The signed copy needs Documents switched on.
                  </p>
                )}
              </div>
            )}
            {!editing && (
              <p className="text-xs text-muted-foreground">
                Record it, then open it again to attach the signed copy — a photo, a file, or one already in Documents.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !ready}>
              {pending ? (editing ? "Saving…" : "Recording…") : editing ? "Save" : "Record waiver"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The chase: one click raises a Work item linked to the order — "Lien waiver
 * from Pleasant Valley Feed Mill: unconditional through 2026-10-31
 * (SC-24109-1)" — beside everything else the office has to do. Not a task
 * engine of the pack's own; work raised where it lives.
 */
export function AskForWaiverButton({
  projectId,
  commitmentId,
  missing,
  throughDate,
}: {
  projectId: string;
  commitmentId: string;
  missing: "unconditional" | "conditional";
  throughDate: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await askForWaiverAction({ projectId, commitmentId, missing, throughDate });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success("Added to Work");
          router.refresh();
        })
      }
    >
      {pending ? "Adding…" : "Ask for it"}
    </Button>
  );
}
