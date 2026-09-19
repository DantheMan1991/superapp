"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setMemberAccountantAction } from "./actions";
import { setMemberAccessAction } from "../settings/access/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Radix refuses an empty string as a value, so "no level" carries a sentinel. */
const NO_LEVEL = "__none__";

export function AccountantToggle({
  membershipId,
  accountant,
}: {
  membershipId: string;
  accountant: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Switch
      checked={accountant}
      disabled={pending}
      onCheckedChange={(next) =>
        startTransition(async () => {
          const res = await setMemberAccountantAction({
            membershipId,
            accountant: next,
          });
          if ("error" in res) {
            toast.error(res.error);
            return;
          }
          toast.success(
            next
              ? "Marked as accountant — read and review access only."
              : "Accountant access removed.",
          );
          router.refresh();
        })
      }
      aria-label="Accountant access"
    />
  );
}

export interface CompanyChoice {
  id: string;
  name: string;
}

/**
 * WHAT ONE PERSON MAY REACH (ADR 0093, ADR 0094).
 *
 * A dialog rather than two controls in a table row, because the two answers are
 * read together — "Dave is field crew, on Prefab" is one sentence — and a row
 * carrying a select and a tick list is a row nobody can scan.
 *
 * **THE TWO HALVES ARE NOT THE SAME KIND OF THING, and the copy says so.** The
 * level decides which SCREENS he can open and is enforced by the application.
 * The companies decide which ROWS he can read and are enforced by Postgres. An
 * owner does not need those words, but they do need to know that one of them
 * hides money and the other hides menus.
 *
 * Never shown for an owner or for yourself: an owner cannot be restricted at
 * all, and a locked-out owner with nobody to unlock them is a problem nothing
 * in the product can fix.
 */
export function MemberAccessButton({
  membershipId,
  name,
  levelId,
  levelName,
  entityIds,
  levels,
  companies,
}: {
  membershipId: string;
  name: string;
  levelId: string | null;
  levelName: string | null;
  entityIds: string[];
  levels: { id: string; name: string }[];
  companies: CompanyChoice[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(levelId ?? NO_LEVEL);
  const [picked, setPicked] = useState<string[]>(entityIds);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  function save() {
    startTransition(async () => {
      const res = await setMemberAccessAction({
        membershipId,
        levelId: level === NO_LEVEL ? null : level,
        entityIds: picked,
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Saved");
      setOpen(false);
      router.refresh();
    });
  }

  // What the row says without opening anything. Two plain clauses, because the
  // common answer is "everything" and it should read as reassurance.
  const summary = [
    levelName ?? "Every tool",
    picked.length === 0
      ? "every company"
      : picked.length === 1
        ? (companies.find((c) => c.id === picked[0])?.name ?? "1 company")
        : `${picked.length} companies`,
  ].join(" · ");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[16rem] truncate">
          {summary}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Access for {name}</DialogTitle>
          <DialogDescription>
            Changes reach them on their next page load. Nobody is signed out.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor={`level-${membershipId}`}>Level</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger id={`level-${membershipId}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LEVEL}>Every tool</SelectItem>
                {levels.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Which screens they can open. Make levels under Settings, Access.
            </p>
          </div>

          {/* Only above one company, the rule accounting's own picker keeps: a
              business with one set of books never meets the idea. */}
          {companies.length > 1 && (
            <div className="grid gap-2">
              <Label htmlFor={`companies-${membershipId}`}>Companies</Label>
              <div id={`companies-${membershipId}`} className="grid gap-1.5">
                {companies.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={picked.includes(c.id)}
                      onCheckedChange={() => toggle(c.id)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Which books they can see. Tick nothing and they see every company.
                This one is not just the menu — entries, invoices, bills and
                reports for the others are not returned to them at all.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
