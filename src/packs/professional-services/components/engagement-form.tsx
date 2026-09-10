"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createEngagementAction, updateEngagementAction } from "../actions";
import { SUGGESTED_ENGAGEMENT_KINDS, engagementKindLabel } from "../vocabulary";

const NEW_CLIENT = "__new__";
/**
 * What a new engagement opens on. NOT `kindOptions[0]`, which is alphabetical
 * and so offered "Hourly" first — found by driving. The schema defaults
 * `ps_engagements.kind` to `retainer`, and the form should agree with it.
 */
const DEFAULT_KIND = "retainer";
const CUSTOM_KIND = "__custom__";

/** Hours in the field, minutes on the wire — the same trade the cost fields make. */
function hoursToMinutes(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : 0;
}

function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export interface EngagementFormView {
  id: string;
  version: number;
  name: string;
  kind: string;
  scope: string;
  startsOn: string;
  endsOn: string | null;
  /** Dollars as strings for the number inputs; empty when unset. */
  feeInput: string;
  rateInput: string;
  /** Hours as a string. */
  retainerInput: string;
  notes: string;
}

/**
 * Agree an engagement, or change its terms.
 *
 * One dialog for both, because the fields are the same question either way
 * and two near-identical forms drift. The client picker is CREATE ONLY: an
 * engagement for somebody else is a different engagement, and moving one
 * would silently move its whole time log with it.
 *
 * The kind picker offers the suggested list and a free-text escape, because
 * `ps_engagements.kind` is an open taxonomy — the database checks the format
 * and never the values. A closed dropdown here would quietly turn an open
 * column into an enum, in the UI instead of the schema.
 */
export function EngagementForm({
  clients,
  kindsInUse,
  today,
  engagement,
  engagementWord,
  clientWord,
}: {
  clients: { id: string; name: string }[];
  kindsInUse: string[];
  /** The tenant's today, so a new engagement starts on their day, not the server's. */
  today: string;
  /** Present when editing. */
  engagement?: EngagementFormView;
  engagementWord: string;
  clientWord: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const kindOptions = [
    ...new Set<string>([...SUGGESTED_ENGAGEMENT_KINDS, ...kindsInUse]),
  ].sort();
  const editing = engagement !== undefined;

  const [kindChoice, setKindChoice] = useState<string>(
    engagement
      ? kindOptions.includes(engagement.kind)
        ? engagement.kind
        : CUSTOM_KIND
      : DEFAULT_KIND,
  );
  const [customKind, setCustomKind] = useState(
    engagement && !kindOptions.includes(engagement.kind) ? engagement.kind : "",
  );
  const [clientChoice, setClientChoice] = useState<string>(clients[0]?.id ?? NEW_CLIENT);

  function submit(formData: FormData) {
    const kind = (kindChoice === CUSTOM_KIND ? customKind : kindChoice)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    const shared = {
      name: String(formData.get("name") ?? ""),
      kind,
      scope: String(formData.get("scope") ?? ""),
      startsOn: String(formData.get("startsOn") ?? ""),
      endsOn: String(formData.get("endsOn") ?? "") || null,
      feeCents: dollarsToCents(String(formData.get("fee") ?? "")),
      rateCents: dollarsToCents(String(formData.get("rate") ?? "")),
      retainerMinutesMonthly: hoursToMinutes(String(formData.get("retainerHours") ?? "")),
      notes: String(formData.get("notes") ?? ""),
    };

    startTransition(async () => {
      const result = engagement
        ? await updateEngagementAction({
            engagementId: engagement.id,
            expectedVersion: engagement.version,
            ...shared,
          })
        : await createEngagementAction({
            ...shared,
            partyId: clientChoice === NEW_CLIENT ? null : clientChoice,
            clientName:
              clientChoice === NEW_CLIENT ? String(formData.get("clientName") ?? "") : null,
          });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Terms saved" : `${engagementWord} agreed`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={editing ? "outline" : "default"}>
          {editing ? "Edit terms" : `New ${engagementWord.toLowerCase()}`}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Change the terms" : `Agree a new ${engagementWord.toLowerCase()}`}
            </DialogTitle>
            <DialogDescription>
              What you have agreed to do, for whom, for how much, from when.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {!editing && (
              <div className="grid gap-2">
                <Label htmlFor="client">{clientWord}</Label>
                <Select value={clientChoice} onValueChange={setClientChoice}>
                  <SelectTrigger id="client">
                    <SelectValue placeholder={`Pick a ${clientWord.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_CLIENT}>Somebody new…</SelectItem>
                  </SelectContent>
                </Select>
                {clientChoice === NEW_CLIENT && (
                  <Input
                    name="clientName"
                    aria-label={`New ${clientWord.toLowerCase()}`}
                    placeholder="Their business name"
                    maxLength={200}
                    required
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  This cannot be changed later — work for somebody else is its own{" "}
                  {engagementWord.toLowerCase()}.
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                required
                maxLength={200}
                autoFocus
                defaultValue={engagement?.name}
                placeholder="Monthly bookkeeping"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="kind">Kind</Label>
              <Select value={kindChoice} onValueChange={setKindChoice}>
                <SelectTrigger id="kind">
                  <SelectValue placeholder="Pick a kind" />
                </SelectTrigger>
                <SelectContent>
                  {kindOptions.map((k) => (
                    <SelectItem key={k} value={k}>
                      {engagementKindLabel(k)}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_KIND}>Something else…</SelectItem>
                </SelectContent>
              </Select>
              {kindChoice === CUSTOM_KIND && (
                <Input
                  aria-label="New kind"
                  placeholder="e.g. fixed_fee"
                  value={customKind}
                  onChange={(e) => setCustomKind(e.target.value)}
                  maxLength={63}
                  required
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="startsOn">Starts</Label>
                <Input
                  id="startsOn"
                  name="startsOn"
                  type="date"
                  required
                  defaultValue={engagement?.startsOn ?? today}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="endsOn">Ends</Label>
                <Input
                  id="endsOn"
                  name="endsOn"
                  type="date"
                  defaultValue={engagement?.endsOn ?? ""}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="retainerHours">Hours a month</Label>
                <Input
                  id="retainerHours"
                  name="retainerHours"
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="0"
                  defaultValue={engagement?.retainerInput}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="fee">Fee</Label>
                <Input
                  id="fee"
                  name="fee"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Blank if none"
                  defaultValue={engagement?.feeInput}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="rate">Rate an hour</Label>
                <Input
                  id="rate"
                  name="rate"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Blank if none"
                  defaultValue={engagement?.rateInput}
                />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              Hours a month is what the fee covers. The rate prices anything beyond it.
            </p>

            <div className="grid gap-2">
              <Label htmlFor="scope">Scope</Label>
              <Textarea
                id="scope"
                name="scope"
                rows={3}
                maxLength={5000}
                placeholder="What you have agreed to do."
                defaultValue={engagement?.scope}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                rows={2}
                maxLength={5000}
                defaultValue={engagement?.notes}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save terms" : `Add ${engagementWord.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
