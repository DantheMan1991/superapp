"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createOutlineAction,
  deleteOutlineAction,
  duplicateOutlineAction,
  setDefaultOutlineAction,
} from "../outline-actions";

/**
 * The outline list's buttons (X1, ADR 0098).
 *
 * **THE COST CODE LIST IS THE FAST ROAD IN**, and the new-outline dialog says
 * so rather than hiding it behind a second screen. A business's chart of cost
 * is already its phases in the order it builds them, so reading a starter off
 * it beats typing thirty step names — and `Nothing, start empty` is there for
 * the business whose chart is not in build order.
 */

const EMPTY = "__empty__";

export function NewOutlineButton({
  costCodeSets,
}: {
  costCodeSets: { id: string; name: string; isDefault: boolean }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [from, setFrom] = useState<string>(
    costCodeSets.find((s) => s.isDefault)?.id ?? costCodeSets[0]?.id ?? EMPTY,
  );

  function submit() {
    startTransition(async () => {
      const result = await createOutlineAction({
        name: name.trim(),
        fromCostCodeSetId: from === EMPTY ? undefined : from,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      setName("");
      router.push(`/dashboard/m/jobs/estimate-outlines/${result.outlineId}`);
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> New outline
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New outline</DialogTitle>
            <DialogDescription>
              A way of walking an estimate. Most businesses keep one per kind of
              job — a new build and a remodel ask different questions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="outline-name">Name</Label>
              <Input
                id="outline-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Remodel"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outline-from">Start from</Label>
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger id="outline-from">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {costCodeSets.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={EMPTY}>Nothing — start empty</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A cost code list gives you a step per code, in the same order,
                each one asking who does the work. Prune it and write your own
                questions in.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || name.trim() === ""}>
              {pending ? "Adding…" : "Add outline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MakeDefaultOutlineButton({ outlineId }: { outlineId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setDefaultOutlineAction({ outlineId });
          if ("error" in result) toast.error(result.error);
          else {
            toast.success("Default outline set");
            router.refresh();
          }
        })
      }
    >
      <Star className="mr-1.5 size-4" /> Make default
    </Button>
  );
}

export function DuplicateOutlineButton({
  outlineId,
  name,
}: {
  outlineId: string;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [copyName, setCopyName] = useState(`${name} copy`);

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setCopyName(`${name} copy`);
          setOpen(true);
        }}
      >
        <Copy className="mr-1.5 size-4" /> Duplicate
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicate “{name}”</DialogTitle>
            <DialogDescription>
              Every step and question, copied. Nobody writes a second outline
              from nothing — they take the nearest one and change it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="copy-name">Name</Label>
            <Input
              id="copy-name"
              value={copyName}
              onChange={(e) => setCopyName(e.target.value)}
              maxLength={120}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={pending || copyName.trim() === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await duplicateOutlineAction({
                    outlineId,
                    name: copyName.trim(),
                  });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  setOpen(false);
                  router.push(
                    `/dashboard/m/jobs/estimate-outlines/${result.outlineId}`,
                  );
                })
              }
            >
              {pending ? "Copying…" : "Duplicate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteOutlineButton({
  outlineId,
  name,
  steps,
}: {
  outlineId: string;
  name: string;
  steps: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Trash2 className="mr-1.5 size-4" /> Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{name}”?</DialogTitle>
            <DialogDescription>
              {steps === 1
                ? "Its one step goes with it."
                : `All ${steps} steps and their questions go with it.`}{" "}
              Estimates you have already written are not touched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteOutlineAction({ outlineId });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  setOpen(false);
                  toast.success("Outline deleted");
                  router.refresh();
                })
              }
            >
              {pending ? "Deleting…" : "Delete outline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
