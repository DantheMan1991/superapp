"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { recordBondAction, setBondStatusAction, setBondingLineAction, updateBondAction } from "../actions";
import { BOND_STATUSES, BOND_STATUS_LABELS, SUGGESTED_BOND_KINDS, slugLabel, type BondStatus } from "../vocabulary";

const NONE = "__none__";

export interface BondPartyOption {
  id: string;
  name: string;
}

export interface BondCodeOption {
  id: string;
  label: string;
}

export interface BondContractOption {
  id: string;
  label: string;
}

export interface EditableBond {
  id: string;
  version: number;
  kind: string;
  number: string;
  suretyPartyId: string | null;
  penalSum: string;
  premium: string;
  costCodeId: string | null;
  contractId: string | null;
  effectiveOn: string | null;
  expiresOn: string | null;
  notes: string;
  status: BondStatus;
}

/**
 * A bond as the office records it (ADR 0078): which kind, from which surety,
 * for how much, what it cost and when it runs out. The kind is an open
 * taxonomy — the five offered are the common ones, and anything lowercase
 * with underscores is accepted, because what a business posts differs by
 * state and by obligee.
 */
export function BondDialog({
  projectId,
  parties,
  codes,
  contracts,
  existing,
}: {
  projectId: string;
  parties: BondPartyOption[];
  codes: BondCodeOption[];
  contracts: BondContractOption[];
  existing?: EditableBond;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState(existing?.kind ?? "performance");
  const [number, setNumber] = useState(existing?.number ?? "");
  const [suretyPartyId, setSuretyPartyId] = useState(existing?.suretyPartyId ?? NONE);
  const [penalSum, setPenalSum] = useState(existing?.penalSum ?? "");
  const [premium, setPremium] = useState(existing?.premium ?? "");
  const [costCodeId, setCostCodeId] = useState(existing?.costCodeId ?? NONE);
  const [contractId, setContractId] = useState(existing?.contractId ?? NONE);
  const [effectiveOn, setEffectiveOn] = useState(existing?.effectiveOn ?? "");
  const [expiresOn, setExpiresOn] = useState(existing?.expiresOn ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  function save() {
    if (kind.trim() === "" || penalSum.trim() === "") {
      toast.error("Say what kind of bond it is and what it covers.");
      return;
    }
    startTransition(async () => {
      const fields = {
        projectId,
        kind: kind.trim().toLowerCase(),
        number,
        suretyPartyId: suretyPartyId === NONE ? null : suretyPartyId,
        penalSum: penalSum.trim(),
        premium: premium.trim(),
        costCodeId: costCodeId === NONE ? null : costCodeId,
        contractId: contractId === NONE ? null : contractId,
        effectiveOn,
        expiresOn,
        notes,
      };
      const result = existing
        ? await updateBondAction({ ...fields, id: existing.id, version: existing.version })
        : await recordBondAction(fields);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(existing ? "Bond saved." : effectiveOn ? "Bond recorded, in force." : "Bond recorded, asked for.");
      setOpen(false);
      if (!existing) {
        setKind("performance");
        setNumber("");
        setSuretyPartyId(NONE);
        setPenalSum("");
        setPremium("");
        setCostCodeId(NONE);
        setContractId(NONE);
        setEffectiveOn("");
        setExpiresOn("");
        setNotes("");
      }
      router.refresh();
    });
  }

  return (
    <>
      {existing ? (
        <Button variant="ghost" size="icon" aria-label={`Edit the ${slugLabel(existing.kind).toLowerCase()} bond`} onClick={() => setOpen(true)}>
          <Pencil className="size-4" />
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Record a bond
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{existing ? `${slugLabel(existing.kind)} bond` : "Record a bond"}</DialogTitle>
            <DialogDescription>
              What your surety has written for this job. Leave the day it took effect blank while you have only asked for it; filling it in puts the
              bond in force.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bd-kind">Kind</Label>
                <Input
                  id="bd-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  list="bond-kinds"
                  maxLength={63}
                  placeholder="performance"
                />
                <datalist id="bond-kinds">
                  {SUGGESTED_BOND_KINDS.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bd-number">Bond number</Label>
                <Input id="bd-number" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={100} placeholder="SUR-4471082" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bd-penal">What it covers</Label>
                <Input id="bd-penal" value={penalSum} onChange={(e) => setPenalSum(e.target.value)} inputMode="decimal" placeholder="250,000.00" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bd-premium">Premium</Label>
                <Input id="bd-premium" value={premium} onChange={(e) => setPremium(e.target.value)} inputMode="decimal" placeholder="3,750.00" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bd-surety">Surety</Label>
                <Select value={suretyPartyId} onValueChange={setSuretyPartyId}>
                  <SelectTrigger id="bd-surety">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not named</SelectItem>
                    {parties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bd-contract">Against the contract</Label>
                <Select value={contractId} onValueChange={setContractId}>
                  <SelectTrigger id="bd-contract">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No contract yet</SelectItem>
                    {contracts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="bd-effective">Took effect</Label>
                <Input id="bd-effective" type="date" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bd-expires">Runs out</Label>
                <Input id="bd-expires" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bd-code">Premium&apos;s cost code</Label>
                <Select value={costCodeId} onValueChange={setCostCodeId}>
                  <SelectTrigger id="bd-code">
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
              <Label htmlFor="bd-notes">Notes</Label>
              <Textarea id="bd-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={4000} />
            </div>
            {!existing && effectiveOn === "" && (
              <p className="text-xs text-muted-foreground">
                With no date it took effect this is recorded as asked for. It still counts against your line, because the job is going ahead either
                way.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending || kind.trim() === "" || penalSum.trim() === ""}>
              {existing ? "Save" : "Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Issued, released or dropped, with the day each needs. Releasing is what gives the capacity back. */
export function BondStatusDialog({
  projectId,
  bond,
  today,
}: {
  projectId: string;
  bond: { id: string; kind: string; status: BondStatus; effectiveOn: string | null; releasedOn: string | null };
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<BondStatus>(bond.status);
  const [effectiveOn, setEffectiveOn] = useState(bond.effectiveOn ?? today);
  const [releasedOn, setReleasedOn] = useState(bond.releasedOn ?? today);

  function save() {
    startTransition(async () => {
      const result = await setBondStatusAction({
        projectId,
        id: bond.id,
        status,
        effectiveOn: status === "requested" || status === "void" ? "" : effectiveOn,
        releasedOn: status === "released" ? releasedOn : "",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${slugLabel(bond.kind)} bond: ${BOND_STATUS_LABELS[status].toLowerCase()}.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <ShieldCheck className="mr-1.5 size-4" /> Standing
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Where the {slugLabel(bond.kind).toLowerCase()} bond stands</DialogTitle>
            <DialogDescription>Releasing it gives its share of your line back. Dropping one you never got leaves the record.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bs-status">Standing</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as BondStatus)}>
                <SelectTrigger id="bs-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOND_STATUSES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {BOND_STATUS_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(status === "issued" || status === "released") && (
              <div className="space-y-1.5">
                <Label htmlFor="bs-effective">Took effect</Label>
                <Input id="bs-effective" type="date" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} />
              </div>
            )}
            {status === "released" && (
              <div className="space-y-1.5">
                <Label htmlFor="bs-released">Released</Label>
                <Input id="bs-released" type="date" value={releasedOn} onChange={(e) => setReleasedOn(e.target.value)} />
              </div>
            )}
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

/** The two numbers off the surety's letter, per company. Owner-only. */
export function BondingLineDialog({
  entityId,
  entityName,
  singleJobLimit,
  aggregateLimit,
  suretyPartyId,
  notes,
  parties,
}: {
  entityId: string;
  entityName: string;
  singleJobLimit: string;
  aggregateLimit: string;
  suretyPartyId: string | null;
  notes: string;
  parties: BondPartyOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [single, setSingle] = useState(singleJobLimit);
  const [aggregate, setAggregate] = useState(aggregateLimit);
  const [surety, setSurety] = useState(suretyPartyId ?? NONE);
  const [note, setNote] = useState(notes);
  const isSet = singleJobLimit !== "" || aggregateLimit !== "";

  function save() {
    startTransition(async () => {
      const result = await setBondingLineAction({
        entityId,
        singleJobLimit: single.trim(),
        aggregateLimit: aggregate.trim(),
        suretyPartyId: surety === NONE ? null : surety,
        notes: note,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Bonding line saved.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="mr-1.5 size-4" /> {isSet ? "Change the line" : "Set the line"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{entityName}&apos;s bonding line</DialogTitle>
            <DialogDescription>
              The two numbers off your surety&apos;s letter. They live here because they are nowhere in your books, and nothing can tell you what is
              left without them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bl-single">Single job</Label>
                <Input id="bl-single" value={single} onChange={(e) => setSingle(e.target.value)} inputMode="decimal" placeholder="1,500,000.00" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bl-aggregate">Aggregate</Label>
                <Input
                  id="bl-aggregate"
                  value={aggregate}
                  onChange={(e) => setAggregate(e.target.value)}
                  inputMode="decimal"
                  placeholder="5,000,000.00"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bl-surety">Surety</Label>
              <Select value={surety} onValueChange={setSurety}>
                <SelectTrigger id="bl-surety">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not named</SelectItem>
                  {parties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bl-notes">Notes</Label>
              <Textarea id="bl-notes" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} placeholder="Reviewed each June with the audited statement." />
            </div>
            <p className="text-xs text-muted-foreground">Either can be left blank. Half a line is worth more than none.</p>
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
