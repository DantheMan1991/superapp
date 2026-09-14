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
import { createProjectAction, updateProjectAction } from "../actions";
import {
  PROJECT_STATUSES,
  STATUS_LABELS,
  slugLabel,
} from "../vocabulary";

interface Option {
  id: string;
  name: string;
}

const NONE = "__none__";

/**
 * Start a project.
 *
 * **THE COMPANY PICKER ONLY APPEARS AT TWO**, which is ADR 0010's own rule for
 * `entities`: a single-company business never learns the word, and the one
 * company is submitted silently. The division and the cost code list follow the
 * same principle — a business with no divisions, or with one list, is asked
 * nothing about them.
 *
 * **THE KIND OF WORK IS A FREE-TEXT BOX when the profile suggests nothing.** The
 * suggestions come from the installed industry profile, never from this pack, so
 * a tenant with no profile still gets a working field rather than an empty
 * dropdown it cannot get past.
 */
export interface EditableProject {
  id: string;
  version: number;
  number: string;
  name: string;
  status: string;
  deliveryMethod: string | null;
  partyId: string | null;
  enterpriseId: string | null;
  costCodeSetId: string | null;
  address: string;
  startsOn: string | null;
  endsOn: string | null;
  notes: string;
}

export function ProjectForm({
  entities,
  parties,
  enterprises,
  costCodeSets,
  deliveryMethods,
  projectWord,
  clientWord,
  existing,
  trigger,
}: {
  entities: Option[];
  parties: Option[];
  enterprises: Option[];
  costCodeSets: Array<{ id: string; name: string; isDefault: boolean }>;
  deliveryMethods: string[];
  projectWord: string;
  clientWord: string;
  /** When set, edits this project instead of creating one. */
  existing?: EditableProject;
  /** Replaces the default button, for a page that wants its own affordance. */
  trigger?: ReactNode;
}) {
  const editing = existing !== undefined;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [number, setNumber] = useState(existing?.number ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [partyId, setPartyId] = useState(existing?.partyId ?? NONE);
  const [enterpriseId, setEnterpriseId] = useState(existing?.enterpriseId ?? NONE);
  const [costCodeSetId, setCostCodeSetId] = useState(existing?.costCodeSetId ?? NONE);
  const [deliveryMethod, setDeliveryMethod] = useState(existing?.deliveryMethod ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(existing?.endsOn ?? "");
  const [status, setStatus] = useState(existing?.status ?? "planned");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const ready = number.trim() !== "" && name.trim() !== "" && entityId !== "";
  const defaultSet = costCodeSets.find((s) => s.isDefault);

  function submit() {
    startTransition(async () => {
      const fields = {
        number: number.trim(),
        name: name.trim(),
        partyId: partyId === NONE ? "" : partyId,
        enterpriseId: enterpriseId === NONE ? "" : enterpriseId,
        costCodeSetId: costCodeSetId === NONE ? "" : costCodeSetId,
        deliveryMethod: deliveryMethod.trim(),
        address: address.trim(),
        startsOn,
        endsOn,
        status,
        notes: notes.trim(),
      };
      /**
       * **THE VERSION GOES WITH THE EDIT.** It is what makes two people on one
       * job a refusal rather than a silent overwrite: the row carries the
       * version it was read at, and `updateProject` refuses if the stored one
       * has moved. Without it the last save wins and the first person's change
       * disappears with nothing said.
       */
      const result = editing
        ? await updateProjectAction({
            ...fields,
            id: existing.id,
            version: existing.version,
            entityId,
          })
        : await createProjectAction({ ...fields, entityId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? `${projectWord} saved` : `${projectWord} added`);
      setOpen(false);
      if (!editing) {
        setNumber("");
        setName("");
        setPartyId(NONE);
        setEnterpriseId(NONE);
        setCostCodeSetId(NONE);
        setDeliveryMethod("");
        setAddress("");
        setStartsOn("");
        setEndsOn("");
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
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> New {projectWord.toLowerCase()}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit" : "New"} {projectWord.toLowerCase()}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="project-number">Number</Label>
                <Input
                  id="project-number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="24-108"
                  maxLength={40}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-start">Starts</Label>
                <Input
                  id="project-start"
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="project-status">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-full" id="project-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_STATUSES.map((v) => (
                      <SelectItem key={v} value={v}>
                        {STATUS_LABELS[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {status === "cancelled" && (
                  /*
                   * SAID BEFORE IT HAPPENS, because the effect is invisible
                   * afterwards: cancelling takes the job off every list a bill
                   * or an hour can be charged to. Completing does NOT — bills
                   * arrive for months after a job finishes.
                   */
                  <p className="text-xs text-muted-foreground">
                    Nothing new can be charged to a cancelled{" "}
                    {projectWord.toLowerCase()}. What is already on it stays.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-end">Ends</Label>
                <Input
                  id="project-end"
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Oak Row residence"
                maxLength={200}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="project-address">Address</Label>
              <Input
                id="project-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Where the work is"
                maxLength={300}
              />
            </div>

            {/* Only at two. A single-company business never learns the word. */}
            {entities.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="project-entity">Company</Label>
                <Select value={entityId} onValueChange={setEntityId}>
                  <SelectTrigger className="w-full" id="project-entity">
                    <SelectValue placeholder="Whose books" />
                  </SelectTrigger>
                  <SelectContent>
                    {entities.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="project-party">{clientWord}</Label>
              <Select value={partyId} onValueChange={setPartyId}>
                <SelectTrigger className="w-full" id="project-party">
                  <SelectValue placeholder={`Pick a ${clientWord.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  {/* A speculative build has no client until it sells. */}
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
              <Label htmlFor="project-kind">Kind of work</Label>
              {deliveryMethods.length > 0 ? (
                <Select
                  value={deliveryMethod || NONE}
                  onValueChange={(v) => setDeliveryMethod(v === NONE ? "" : v)}
                >
                  <SelectTrigger className="w-full" id="project-kind">
                    <SelectValue placeholder="Not decided yet" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* A project may start before anyone knows. ADR 0056. */}
                    <SelectItem value={NONE}>Not decided yet</SelectItem>
                    {deliveryMethods.map((m) => (
                      <SelectItem key={m} value={m}>
                        {slugLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="project-kind"
                  value={deliveryMethod}
                  onChange={(e) => setDeliveryMethod(e.target.value)}
                  placeholder="Leave blank until you know"
                  maxLength={63}
                />
              )}
            </div>

            {enterprises.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="project-enterprise">Division</Label>
                <Select value={enterpriseId} onValueChange={setEnterpriseId}>
                  <SelectTrigger className="w-full" id="project-enterprise">
                    <SelectValue placeholder="Whole business" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Whole business</SelectItem>
                    {enterprises.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/*
              Only at two — one list is the default and needs no question.
              EXCEPT when this row has no list at all and one exists, which is
              the hole driving it found: a project created before the chart of
              cost existed could never be attached to it, because the picker that
              would do it was hidden by the same rule that makes one list
              invisible.
            */}
            {(costCodeSets.length > 1 ||
              (editing && !existing.costCodeSetId && costCodeSets.length > 0)) && (
              <div className="space-y-1.5">
                <Label htmlFor="project-set">Cost codes</Label>
                <Select value={costCodeSetId} onValueChange={setCostCodeSetId}>
                  <SelectTrigger className="w-full" id="project-set">
                    <SelectValue
                      placeholder={defaultSet ? `${defaultSet.name} (default)` : "Pick a list"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      {defaultSet ? `${defaultSet.name} (default)` : "No list"}
                    </SelectItem>
                    {costCodeSets.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="project-notes">Notes</Label>
              <Textarea
                id="project-notes"
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
                  : `Add ${projectWord.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
