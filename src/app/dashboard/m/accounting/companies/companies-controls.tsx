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
import { usePartyWords } from "@/components/app/label-provider";
import { PackField, type PackChoice } from "@/components/app/pack-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Radix refuses an empty string as a value, so "not said" carries a sentinel. */
const NOT_SAID = "__none__";

/** An industry profile as this screen needs it (ADR 0090, 0092). */
export interface ProfileChoice {
  slug: string;
  name: string;
  /**
   * What that trade puts in the menu, in the names a person reads — and only
   * the packs this client has actually switched on, because naming one it does
   * not have would describe a menu nobody will ever see.
   */
  tools: string[];
}

/**
 * Managing the companies inside one client (ADR 0010).
 *
 * Deactivate rather than delete, for the reason the catalogue lists do and more
 * so: a company owns posted journal entries, and removing the row would orphan
 * a set of books. `journal_entries`' foreign key is NO ACTION, so the database
 * refuses it anyway.
 */

export function AddCompanyButton() {
  const words = usePartyWords();
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
              profit &amp; loss and balance sheet. The chart of accounts,{" "}
              {words.customers.toLowerCase()}, {words.vendors.toLowerCase()} and
              contacts stay shared, so you still manage everything in one place.
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

  // The ask happens BEFORE the transition, never inside it. Opening the dialog
  // is a state update, and one made inside a transition cannot commit while
  // that same transition is parked on the promise the dialog resolves — the
  // button would sit there doing nothing at all.
  async function makeDefault() {
    // The consequence stated before it happens: this is where money lands from
    // now on, not a cosmetic marker.
    const asked = await confirm({
      title: `Make ${name} the default company?`,
      description:
        "From now on every invoice, bill, bank transaction and recurring journal posts into its books. Entries already posted do not move.",
      confirmLabel: "Make it the default",
    });
    if (!asked) return;
    startTransition(async () => {
      const result = await setDefaultEntityAction({ entityId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name} is now the default`);
      router.refresh();
    });
  }

  return (
    <>
      {confirmDialog}
      <Button size="sm" variant="outline" disabled={pending} onClick={makeDefault}>
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
  industry,
  packs,
  profiles,
  packChoices,
}: {
  entityId: string;
  name: string;
  legalName: string;
  /** Which line of business it is in, or "" for not said (ADR 0090). */
  industry: string;
  /** The tools it works with when its trade does not describe them (ADR 0092). */
  packs: string[];
  /** The profiles installed on this client, to choose from. */
  profiles: ProfileChoice[];
  /** Every pack this client has switched on, to override that trade with. */
  packChoices: PackChoice[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextName, setNextName] = useState(name);
  const [nextLegal, setNextLegal] = useState(legalName);
  const [nextIndustry, setNextIndustry] = useState(industry);
  const [nextPacks, setNextPacks] = useState<string[]>(packs);
  const [pending, startTransition] = useTransition();
  // Live, not the saved value: somebody changing the line of business wants the
  // sentence under the tools to describe the trade they just picked.
  const chosen = profiles.find((p) => p.slug === nextIndustry);
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
            {/*
              Only once the client runs more than one industry. Asking a
              single-industry business which line of business a company is in is
              a question with one answer, and the menu it feeds never renders.
            */}
            {profiles.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor={`industry-${entityId}`}>Line of business</Label>
                <Select
                  value={nextIndustry === "" ? NOT_SAID : nextIndustry}
                  onValueChange={(v) => setNextIndustry(v === NOT_SAID ? "" : v)}
                >
                  <SelectTrigger id={`industry-${entityId}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_SAID}>Not said</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.slug} value={p.slug}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Only changes what is in the menu down the left when you are working
                  on this side of the business. It does not scope anything: the books,
                  the reports and every page stay exactly as they are.
                </p>
              </div>
            )}
            {/*
              A TRADE IS NOT A BUSINESS (ADR 0092). The line of business above
              is a shortcut that is right most of the time — and when it is not,
              this is where the company says so. Shrock Prefab is in
              construction and runs a factory.
            */}
            <PackField
              id={`packs-${entityId}`}
              choices={packChoices}
              picked={nextPacks}
              onPicked={setNextPacks}
              hint={
                chosen && chosen.tools.length > 0 ? (
                  <>
                    Tick nothing and it uses whatever {chosen.name} uses —{" "}
                    {chosen.tools.join(", ")}. Tick some and those are the menu
                    instead. Accounting, Mail, Documents and the rest are always
                    there.
                  </>
                ) : (
                  <>
                    Tick nothing and every tool stays in the menu, and this
                    company is not offered as a side to switch to. Accounting,
                    Mail, Documents and the rest are always there whichever you
                    pick.
                  </>
                )
              }
            />
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
                    industry: nextIndustry,
                    packs: nextPacks,
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
