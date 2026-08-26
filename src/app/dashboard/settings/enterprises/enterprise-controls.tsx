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
import {
  archiveEnterpriseAction,
  createEnterpriseAction,
  restoreEnterpriseAction,
  updateEnterpriseAction,
} from "./actions";

const KINDS = [
  { value: "livestock", label: "Livestock — animals you raise" },
  { value: "crop", label: "Crop — something you grow" },
  { value: "other", label: "Something else" },
];

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
export function EnterpriseForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("livestock");
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createEnterpriseAction({
        name: String(formData.get("name") ?? ""),
        kind,
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
          Add an enterprise
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add an enterprise</DialogTitle>
            <DialogDescription>
              A line of business you want to see the money for on its own —
              Broilers, Beef, Pigs, Eggs.
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
                placeholder="Broilers"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kind">What kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
export function EnterpriseControls({ enterprise }: { enterprise: EnterpriseRow }) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(enterprise.kind);
  const [pending, startTransition] = useTransition();
  const archived = enterprise.status === "archived";

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await updateEnterpriseAction({
        id: enterprise.id,
        name: String(formData.get("name") ?? ""),
        kind,
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
                  Renaming is safe — every record already tagged with this
                  enterprise follows the new name, including in reports.
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
                <div className="grid gap-2">
                  <Label htmlFor={`kind-${enterprise.id}`}>What kind</Label>
                  <Select value={kind} onValueChange={setKind}>
                    <SelectTrigger id={`kind-${enterprise.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                      {/* A kind that came from a seed or an import and is not
                          one of the three stays selectable rather than being
                          silently changed to "other" on the next save. */}
                      {!KINDS.some((k) => k.value === enterprise.kind) && (
                        <SelectItem value={enterprise.kind}>
                          {enterprise.kind}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
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
