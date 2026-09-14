"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Star } from "lucide-react";
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
  updateCostCodeAction,
  updateCostCodeSetAction,
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

/** Rename a list. Which projects use it is deliberately not editable here. */
export function EditSetButton({
  setId,
  name,
  version,
}: {
  setId: string;
  name: string;
  version: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(name);

  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
        <Pencil className="size-4" />
        <span className="sr-only">Rename {name}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename list</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`set-name-${setId}`}>Name</Label>
            <Input
              id={`set-name-${setId}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={120}
            />
            <p className="text-xs text-muted-foreground">
              Projects already budgeted against this list keep it. Renaming
              changes what it is called, not what it is charged to.
            </p>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || value.trim() === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await updateCostCodeSetAction({
                    id: setId,
                    name: value.trim(),
                    version,
                  });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("List renamed");
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

/**
 * Change one code, or take it off the list.
 *
 * **RETIRED, NEVER DELETED**, and the dialog says so rather than offering a
 * delete that would take a year of job history with it. A retired code stops
 * being offered and everything already charged to it stays exactly where it is.
 */
export function EditCodeButton({
  code,
}: {
  code: {
    id: string;
    code: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [codeText, setCodeText] = useState(code.code);
  const [name, setName] = useState(code.name);
  const [sortOrder, setSortOrder] = useState(String(code.sortOrder));
  const [isActive, setIsActive] = useState(code.isActive);

  function save() {
    startTransition(async () => {
      const parsedOrder = Number(sortOrder);
      const result = await updateCostCodeAction({
        id: code.id,
        code: codeText.trim(),
        name: name.trim(),
        sortOrder: Number.isFinite(parsedOrder) ? Math.trunc(parsedOrder) : undefined,
        isActive,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Code saved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
        <Pencil className="size-4" />
        <span className="sr-only">Edit {code.code}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit cost code</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`code-${code.id}`}>Code</Label>
                <Input
                  id={`code-${code.id}`}
                  value={codeText}
                  onChange={(e) => setCodeText(e.target.value)}
                  maxLength={40}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`order-${code.id}`}>Order</Label>
                <Input
                  id={`order-${code.id}`}
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`name-${code.id}`}>Name</Label>
              <Input
                id={`name-${code.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!isActive}
                  onChange={(e) => setIsActive(!e.target.checked)}
                />
                <span>
                  <span className="font-medium">Retire this code</span>
                  <span className="block text-xs text-muted-foreground">
                    It stops being offered on new work. Everything already
                    charged to it stays where it is — codes are never deleted.
                  </span>
                </span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={save}
              disabled={pending || codeText.trim() === "" || name.trim() === ""}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
