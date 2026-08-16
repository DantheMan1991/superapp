"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/app/use-confirm";
import {
  createEntityAction,
  setDefaultEntityAction,
  updateEntityAction,
} from "@/modules/accounting/entity-actions";

/**
 * Managing the companies inside one client (ADR 0010).
 *
 * Deactivate rather than delete, for the reason the catalogue lists do and more
 * so: a company owns posted journal entries, and removing the row would orphan
 * a set of books. `journal_entries`' foreign key is NO ACTION, so the database
 * refuses it anyway.
 */

export function AddCompanyButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await createEntityAction({
        name,
        legalName: legalName.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name.trim()} added`);
      setOpen(false);
      setName("");
      setLegalName("");
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add a company
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a company</DialogTitle>
            <DialogDescription>
              A second company keeps its own books — its own trial balance,
              profit &amp; loss and balance sheet. The chart of accounts,
              customers, vendors and contacts stay shared, so you still manage
              everything in one place.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="company-name">Name</Label>
              <Input
                id="company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Maple Street LLC"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-legal">Legal name (optional)</Label>
              <Input
                id="company-legal"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="The name on the tax return, if it differs"
              />
            </div>
            {/* Said before it happens, not discovered afterwards: new
                companies start empty and nothing moves into them by itself. */}
            <p className="text-xs text-muted-foreground">
              Nothing moves across. Invoices, bills and bank transactions keep
              posting to your default company until you change it; a journal
              entry can name this one straight away.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || name.trim() === ""} onClick={submit}>
              {pending ? "Adding…" : "Add company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MakeDefaultButton({
  entityId,
  name,
}: {
  entityId: string;
  name: string;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  return (
    <>
      {confirmDialog}
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            // The consequence stated before it happens: this is where money
            // lands from now on, not a cosmetic marker.
            const ok = await confirm({
              title: `Make ${name} the default company?`,
              description:
                "From now on every invoice, bill, bank transaction and recurring journal posts into its books. Entries already posted do not move.",
              confirmLabel: "Make it the default",
            });
            if (!ok) return;
            const result = await setDefaultEntityAction({ entityId });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success(`${name} is now the default`);
            router.refresh();
          })
        }
      >
        <Star className="h-3.5 w-3.5" />
        Make default
      </Button>
    </>
  );
}

export function ActiveToggle({
  entityId,
  name,
  isActive,
}: {
  entityId: string;
  name: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await updateEntityAction({
            entityId,
            isActive: !isActive,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(
            isActive ? `${name} deactivated` : `${name} reactivated`,
          );
          router.refresh();
        })
      }
    >
      {isActive ? "Deactivate" : "Reactivate"}
    </Button>
  );
}

export function RenameButton({
  entityId,
  name,
  legalName,
}: {
  entityId: string;
  name: string;
  legalName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextName, setNextName] = useState(name);
  const [nextLegal, setNextLegal] = useState(legalName);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`rename-${entityId}`}>Name</Label>
              <Input
                id={`rename-${entityId}`}
                value={nextName}
                onChange={(e) => setNextName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`legal-${entityId}`}>Legal name</Label>
              <Input
                id={`legal-${entityId}`}
                value={nextLegal}
                onChange={(e) => setNextLegal(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || nextName.trim() === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await updateEntityAction({
                    entityId,
                    name: nextName,
                    legalName: nextLegal,
                  });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("Saved");
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
