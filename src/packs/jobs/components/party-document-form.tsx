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
  askForPartyDocumentAction,
  attachPartyDocumentDocumentAction,
  attachPartyDocumentFileAction,
  attachPartyDocumentPhotoAction,
  createPartyDocumentAction,
  detachPartyDocumentPhotoAction,
  setPartyDocumentPhotoPrimaryAction,
  updatePartyDocumentAction,
} from "../actions";
import {
  PARTY_DOCUMENT_FORMAT,
  PARTY_DOCUMENT_STATUSES,
  PARTY_DOCUMENT_STATUS_LABELS,
  SUGGESTED_PARTY_DOCUMENT_KINDS,
  partyDocumentKindLabel,
} from "../vocabulary";

const OTHER = "__other__";

export interface EditablePartyDocument {
  id: string;
  version: number;
  kind: string;
  title: string;
  reference: string;
  issuer: string;
  issuedOn: string | null;
  expiresOn: string | null;
  limitCents: number | null;
  status: string;
  requestedOn: string | null;
  receivedOn: string | null;
  notes: string;
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Safety plan" → "safety_plan": the slug a business's own kind is stored as. */
function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 63);
}

/**
 * Record a document a subcontractor or supplier has on file (ADR 0068): a
 * certificate of insurance with the day it runs out, a W-9, a licence, or
 * whatever else the business asks for.
 *
 * **THE KIND IS THE BUSINESS'S.** The three suggested are labelled; *Other*
 * takes a name and stores its slug, so a business that requires a safety
 * plan or a signed master agreement records those too.
 *
 * **THE EXPIRY IS THE POINT.** A certificate past its date is as good as
 * missing on the subcontractors page; a W-9 has none.
 */
export function PartyDocumentForm({
  partyId,
  partyName,
  requiredKinds,
  documentsOn,
  tenantId,
  canPhoto,
  photos = [],
  files = [],
  existing,
  trigger,
}: {
  partyId: string;
  partyName: string;
  /** The kinds the business requires, offered first. */
  requiredKinds: string[];
  documentsOn: boolean;
  tenantId: string;
  canPhoto: boolean;
  photos?: RecordPhoto[];
  files?: RecordFile[];
  existing?: EditablePartyDocument;
  trigger?: ReactNode;
}) {
  const editing = existing !== undefined;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const known = [...new Set([...requiredKinds, ...SUGGESTED_PARTY_DOCUMENT_KINDS])];
  const initialKind = existing?.kind ?? known[0] ?? "insurance_certificate";
  const [kindPick, setKindPick] = useState(known.includes(initialKind) ? initialKind : OTHER);
  const [otherKind, setOtherKind] = useState(known.includes(initialKind) ? "" : partyDocumentKindLabel(initialKind));
  const [title, setTitle] = useState(existing?.title ?? "");
  const [issuer, setIssuer] = useState(existing?.issuer ?? "");
  const [reference, setReference] = useState(existing?.reference ?? "");
  const [issuedOn, setIssuedOn] = useState(existing?.issuedOn ?? "");
  const [expiresOn, setExpiresOn] = useState(existing?.expiresOn ?? "");
  const [limit, setLimit] = useState(
    existing && existing.limitCents !== null ? (existing.limitCents / 100).toFixed(2) : "",
  );
  const [status, setStatus] = useState(existing?.status ?? "received");
  const [requestedOn, setRequestedOn] = useState(existing?.requestedOn ?? "");
  const [receivedOn, setReceivedOn] = useState(existing?.receivedOn ?? (existing ? "" : today()));
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const kind = kindPick === OTHER ? slugify(otherKind) : kindPick;
  const ready = kind !== "" && PARTY_DOCUMENT_FORMAT.test(kind);

  function changeStatus(next: string) {
    setStatus(next);
    if (next === "received" && receivedOn === "") setReceivedOn(today());
  }

  function submit() {
    startTransition(async () => {
      const payload = {
        partyId,
        kind,
        title: title.trim(),
        issuer: issuer.trim(),
        reference: reference.trim(),
        issuedOn,
        expiresOn,
        limitCents: limit,
        status,
        requestedOn,
        receivedOn: status === "received" ? receivedOn : status === "requested" ? "" : receivedOn,
        notes: notes.trim(),
      };
      const result = editing
        ? await updatePartyDocumentAction({ ...payload, id: existing.id, version: existing.version })
        : await createPartyDocumentAction(payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Document saved" : "Document recorded");
      setOpen(false);
      if (!editing) {
        setTitle("");
        setIssuer("");
        setReference("");
        setIssuedOn("");
        setExpiresOn("");
        setLimit("");
        setStatus("received");
        setRequestedOn("");
        setReceivedOn(today());
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
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Record document
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit document" : "Record a document"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>From</Label>
              <p className="text-sm">{partyName}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pd-kind">Kind</Label>
                <Select value={kindPick} onValueChange={setKindPick}>
                  <SelectTrigger className="w-full" id="pd-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {known.map((k) => (
                      <SelectItem key={k} value={k}>
                        {partyDocumentKindLabel(k)}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER}>Other…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {kindPick === OTHER ? (
                <div className="space-y-1.5">
                  <Label htmlFor="pd-other">What kind</Label>
                  <Input
                    id="pd-other"
                    value={otherKind}
                    onChange={(e) => setOtherKind(e.target.value)}
                    placeholder="Safety plan"
                    maxLength={63}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="pd-title">Title</Label>
                  <Input
                    id="pd-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="General liability"
                    maxLength={200}
                  />
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pd-issuer">Issued by</Label>
                <Input
                  id="pd-issuer"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                  placeholder="The carrier, the state board"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-reference">Number</Label>
                <Input
                  id="pd-reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Policy or licence number"
                  maxLength={120}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pd-issued">Issued</Label>
                <Input id="pd-issued" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-expires">Expires</Label>
                <Input
                  id="pd-expires"
                  type="date"
                  value={expiresOn}
                  onChange={(e) => setExpiresOn(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Blank for one that does not run out, such as a W-9.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-limit">Coverage limit</Label>
                <Input
                  id="pd-limit"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  placeholder="1,000,000"
                  inputMode="decimal"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pd-status">Status</Label>
                <Select value={status} onValueChange={changeStatus}>
                  <SelectTrigger className="w-full" id="pd-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PARTY_DOCUMENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {PARTY_DOCUMENT_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-requested">Requested</Label>
                <Input
                  id="pd-requested"
                  type="date"
                  value={requestedOn}
                  onChange={(e) => setRequestedOn(e.target.value)}
                />
              </div>
              {status === "received" && (
                <div className="space-y-1.5">
                  <Label htmlFor="pd-received">Received</Label>
                  <Input
                    id="pd-received"
                    type="date"
                    value={receivedOn}
                    onChange={(e) => setReceivedOn(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pd-notes">Notes</Label>
              <Textarea
                id="pd-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Additional insured named, endorsements, what is missing"
              />
            </div>

            {editing && (
              <div className="space-y-1.5 rounded-lg border border-border/60 p-3">
                <Label>Scanned copy</Label>
                {documentsOn ? (
                  <RecordPhotos
                    entityId={existing.id}
                    tenantId={tenantId}
                    photos={photos}
                    files={files}
                    canEdit={canPhoto}
                    subject="document"
                    attachAction={attachPartyDocumentPhotoAction}
                    setPrimaryAction={setPartyDocumentPhotoPrimaryAction}
                    detachAction={detachPartyDocumentPhotoAction}
                    attachFileAction={attachPartyDocumentFileAction}
                    attachExistingAction={attachPartyDocumentDocumentAction}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">The scanned copy needs Documents switched on.</p>
                )}
              </div>
            )}
            {!editing && (
              <p className="text-xs text-muted-foreground">
                Record it, then open it again to add a photo of the page.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !ready}>
              {pending ? (editing ? "Saving…" : "Recording…") : editing ? "Save" : "Record document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The chase: one click raises a Work item linked to the party. */
export function AskForDocumentButton({
  partyId,
  kind,
}: {
  partyId: string;
  kind: string;
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
          const result = await askForPartyDocumentAction({ partyId, kind });
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
