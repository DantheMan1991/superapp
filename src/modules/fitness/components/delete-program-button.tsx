"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteProgramAction } from "../actions";
import { countOf } from "../core/program";

/**
 * Delete a program and everything in it, after asking by name, and saying how
 * many workouts go with it: deleting a program deletes its sessions too.
 */
export function DeleteProgramButton({
  programId,
  name,
  sessions,
}: {
  programId: string;
  name: string;
  sessions: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const outcome = await deleteProgramAction({ programId });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setOpen(false);
      toast.success("Program deleted");
      router.push("/personal/m/fitness");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Delete program
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>
            {sessions > 0
              ? `Every phase and exercise in it goes too, and the ${countOf(sessions, "workout", "workouts")} you have done with it. This cannot be undone.`
              : "Every phase and exercise in it goes too. This cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={remove} disabled={pending}>
            {pending ? "Deleting…" : "Delete program"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
