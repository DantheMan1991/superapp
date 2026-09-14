"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Star } from "lucide-react";
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
import {
  createCostCodeAction,
  createCostCodeSetAction,
  setDefaultCostCodeSetAction,
} from "../actions";

/**
 * The chart of cost: a named list, and the codes in it.
 *
 * **NOTHING HERE SUGGESTS A CODE.** CSI MasterFormat is commercial vocabulary,
 * NAHB's chart is residential, and plenty of builders use a list they invented —
 * so the pack ships no starter list at all and a profile seeds one if it wants
 * to. The placeholders are shaped like examples rather than defaults for exactly
 * that reason.
 */
export function NewSetButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await createCostCodeSetAction({ name: name.trim() });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("List added");
      setOpen(false);
      setName("");
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> New list
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New cost code list</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="set-name">Name</Label>
            <Input
              id="set-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Our codes"
              maxLength={120}
            />
            <p className="text-xs text-muted-foreground">
              The first list you add becomes the default, so projects use it
              without being asked.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || name.trim() === ""}>
              {pending ? "Adding…" : "Add list"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MakeDefaultButton({ setId }: { setId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setDefaultCostCodeSetAction({ setId });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success("Default list changed");
          router.refresh();
        })
      }
    >
      <Star className="mr-1.5 size-4" /> Make default
    </Button>
  );
}

export function NewCodeButton({ setId }: { setId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await createCostCodeAction({
        setId,
        code: code.trim(),
        name: name.trim(),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Code added");
      setOpen(false);
      setCode("");
      setName("");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> Add code
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New cost code</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="code-code">Code</Label>
              <Input
                id="code-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                /* An example, not a default: the shape is the business's own. */
                placeholder="e.g. 03 30 00, or 1000, or CONC"
                maxLength={40}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="code-name">Name</Label>
              <Input
                id="code-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Concrete"
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={submit}
              disabled={pending || code.trim() === "" || name.trim() === ""}
            >
              {pending ? "Adding…" : "Add code"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
