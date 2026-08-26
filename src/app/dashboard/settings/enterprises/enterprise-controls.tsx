"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
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
import { useConfirm } from "@/components/app/use-confirm";
import { slugLabel } from "@/lib/enterprises/vocabulary";
import {
  archiveEnterpriseAction,
  createEnterpriseAction,
  restoreEnterpriseAction,
  updateEnterpriseAction,
} from "./actions";

/**
 * **NO LIST OF KINDS LIVES HERE.** The first version held
 * `["livestock", "crop", "other"]` with copy reading *"Livestock — animals you
 * raise"*, which is a Layer 0 form telling a law firm what its lines of
 * business are made of. The installed profile supplies them; a business whose
 * profile supplies none gets a free-text box, which is `runKinds`' arrangement
 * exactly.
 */
const CUSTOM_KIND = "__custom__";
const NO_KIND = "other";

export interface EnterpriseRow {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  notes: string;
}

/**
 * Add an enterprise.
 *
 * **THE NAME IS THE ONLY REQUIRED FIELD, and the handle is never shown as an
 * input.** A slug is a machine's business: derived once from the name, then
 * fixed forever so a rename costs nothing. Asking somebody to choose one would
 * be asking them to make a decision they cannot evaluate and can never revise.
 */
export function EnterpriseForm({
  word,
  kinds,
}: {
  /** What the installed profile calls one. Never hard-coded here. */
  word: string;
  /** Kind suggestions from the profile. Empty means a free-text box. */
  kinds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(kinds[0] ?? NO_KIND);
  const [customKind, setCustomKind] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createEnterpriseAction({
        name: String(formData.get("name") ?? ""),
        kind: kind === CUSTOM_KIND ? customKind.trim() || NO_KIND : kind,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Added");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add {article(word)} {word.toLowerCase()}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>
              Add {article(word)} {word.toLowerCase()}
            </DialogTitle>
            <DialogDescription>
              {/* The definition, not an example. An example is an industry. */}
              A part of the business you want to see the money for on its own.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                required
                maxLength={120}
                autoFocus
              />
            </div>
            <KindField
              id="kind"
              kinds={kinds}
              value={kind}
              onValue={setKind}
              custom={customKind}
              onCustom={setCustomKind}
            />
            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edit one, and retire or restore it.
 *
 * **RETIRING IS OUTSIDE THE DIALOG**, the same arrangement the inventory item
 * controls use and for the same reason: a confirm opened from inside an open
 * dialog is two Radix modals deep, and `useConfirm` has to be awaited before
 * any transition starts.
 */
export function EnterpriseControls({
  enterprise,
  word,
  kinds,
}: {
  enterprise: EnterpriseRow;
  word: string;
  kinds: string[];
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(enterprise.kind);
  const [customKind, setCustomKind] = useState("");
  const [pending, startTransition] = useTransition();
  const archived = enterprise.status === "archived";

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await updateEnterpriseAction({
        id: enterprise.id,
        name: String(formData.get("name") ?? ""),
        kind: kind === CUSTOM_KIND ? customKind.trim() || NO_KIND : kind,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      setOpen(false);
      router.refresh();
    });
  }

  async function retire() {
    // Asked BEFORE the transition starts — see `useConfirm`.
    const asked = await confirm({
      title: `Retire ${enterprise.name}?`,
      description:
        "It stops being offered on new records. Everything already recorded against it keeps reporting, so last year's figures do not move. You can put it back.",
      confirmLabel: "Retire it",
    });
    if (!asked) return;
    startTransition(async () => {
      const result = await archiveEnterpriseAction({ id: enterprise.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Retired");
      router.refresh();
    });
  }

  function restore() {
    startTransition(async () => {
      const result = await restoreEnterpriseAction({ id: enterprise.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Back in the list");
      router.refresh();
    });
  }

  return (
    <>
      {confirmDialog}
      <div className="flex items-center justify-end gap-1">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm">
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Edit
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <form action={submit}>
              <DialogHeader>
                <DialogTitle>Edit {enterprise.name}</DialogTitle>
                <DialogDescription>
                  {/* The one thing somebody will worry about, answered before
                      they have to ask it. */}
                  Renaming is safe — every record already tagged with this{" "}
                  {word.toLowerCase()} follows the new name, including in
                  reports.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor={`name-${enterprise.id}`}>Name</Label>
                  <Input
                    id={`name-${enterprise.id}`}
                    name="name"
                    required
                    maxLength={120}
                    defaultValue={enterprise.name}
                  />
                </div>
                <KindField
                  id={`kind-${enterprise.id}`}
                  kinds={kinds}
                  value={kind}
                  onValue={setKind}
                  custom={customKind}
                  onCustom={setCustomKind}
                  /* A kind that came from a seed or an import and is not one
                     the profile lists stays selectable, rather than being
                     silently changed on the next save. */
                  extra={enterprise.kind}
                />
                <div className="grid gap-2">
                  <Label htmlFor={`notes-${enterprise.id}`}>Notes</Label>
                  <Textarea
                    id={`notes-${enterprise.id}`}
                    name="notes"
                    rows={2}
                    maxLength={5000}
                    defaultValue={enterprise.notes}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {archived ? (
          <Button variant="outline" size="sm" onClick={restore} disabled={pending}>
            Put back
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={retire} disabled={pending}>
            Retire
          </Button>
        )}
      </div>
    </>
  );
}

/**
 * "a" or "an", for a word the PROFILE supplies.
 *
 * **NOT COSMETIC HERE.** The word is renameable, so hard-coding an article is a
 * grammar bug waiting for a profile whose word starts with a vowel — the exact
 * mistake the inventory filter bar shipped as "Find a item by name" the day
 * before this. There is no way to avoid the article on a button reading "Add an
 * enterprise", so the article has to be computed.
 */
function article(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? "an" : "a";
}

/**
 * Pick a kind, or type one.
 *
 * **THE SUGGESTIONS ARE THE PROFILE'S AND THE FIELD ACCEPTS ANYTHING.** With no
 * profile there is no list, and the control is a text box — which is the honest
 * state for a business whose industry nobody has described, and is what
 * `runKinds` does on the production form.
 */
function KindField({
  id,
  kinds,
  value,
  onValue,
  custom,
  onCustom,
  extra,
}: {
  id: string;
  kinds: string[];
  value: string;
  onValue: (v: string) => void;
  custom: string;
  onCustom: (v: string) => void;
  /** A stored kind the profile does not list, kept selectable. */
  extra?: string;
}) {
  const options = [...new Set([...kinds, ...(extra ? [extra] : [])])];

  if (options.length === 0) {
    return (
      <div className="grid gap-2">
        <Label htmlFor={id}>What kind</Label>
        <Input
          id={id}
          value={value === NO_KIND ? "" : value}
          onChange={(e) => onValue(e.target.value.trim() || NO_KIND)}
          maxLength={63}
        />
        <p className="text-xs text-muted-foreground">
          Optional. A word for grouping the list — nothing depends on it.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>What kind</Label>
      <Select value={value} onValueChange={onValue}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((k) => (
            <SelectItem key={k} value={k}>
              {slugLabel(k)}
            </SelectItem>
          ))}
          <SelectItem value={NO_KIND}>Something else</SelectItem>
          <SelectItem value={CUSTOM_KIND}>Name a new kind…</SelectItem>
        </SelectContent>
      </Select>
      {value === CUSTOM_KIND && (
        <Input
          aria-label="New kind"
          value={custom}
          onChange={(e) => onCustom(e.target.value)}
          maxLength={63}
        />
      )}
    </div>
  );
}
