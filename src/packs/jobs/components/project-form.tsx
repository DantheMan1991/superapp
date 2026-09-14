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
import { createProjectAction } from "../actions";
import { slugLabel } from "../vocabulary";

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
export function ProjectForm({
  entities,
  parties,
  enterprises,
  costCodeSets,
  deliveryMethods,
  projectWord,
  clientWord,
}: {
  entities: Option[];
  parties: Option[];
  enterprises: Option[];
  costCodeSets: Array<{ id: string; name: string; isDefault: boolean }>;
  deliveryMethods: string[];
  projectWord: string;
  clientWord: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [partyId, setPartyId] = useState(NONE);
  const [enterpriseId, setEnterpriseId] = useState(NONE);
  const [costCodeSetId, setCostCodeSetId] = useState(NONE);
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [address, setAddress] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [notes, setNotes] = useState("");

  const ready = number.trim() !== "" && name.trim() !== "" && entityId !== "";
  const defaultSet = costCodeSets.find((s) => s.isDefault);

  function submit() {
    startTransition(async () => {
      const result = await createProjectAction({
        entityId,
        number: number.trim(),
        name: name.trim(),
        partyId: partyId === NONE ? "" : partyId,
        enterpriseId: enterpriseId === NONE ? "" : enterpriseId,
        costCodeSetId: costCodeSetId === NONE ? "" : costCodeSetId,
        deliveryMethod: deliveryMethod.trim(),
        address: address.trim(),
        startsOn,
        notes: notes.trim(),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${projectWord} added`);
      setOpen(false);
      setNumber("");
      setName("");
      setPartyId(NONE);
      setEnterpriseId(NONE);
      setCostCodeSetId(NONE);
      setDeliveryMethod("");
      setAddress("");
      setStartsOn("");
      setNotes("");
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> New {projectWord.toLowerCase()}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New {projectWord.toLowerCase()}</DialogTitle>
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

            {/* Only at two: one list is the default and needs no question. */}
            {costCodeSets.length > 1 && (
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
              {pending ? "Adding…" : `Add ${projectWord.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
