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
import { discardImportAction } from "../actions";

/** Throw a draft away, after asking. Its photo goes with it; the link, text or photos were never kept. */
export function DiscardDraftButton({
  importId,
  variant = "ghost",
  size = "default",
}: {
  importId: string;
  variant?: "ghost" | "outline";
  size?: "default" | "sm";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function discard() {
    startTransition(async () => {
      const outcome = await discardImportAction({ importId });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setOpen(false);
      toast.success("Draft discarded");
      router.push("/personal/m/food/recipes");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size}>
          Discard draft
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard this draft?</DialogTitle>
          <DialogDescription>Nothing from it is kept. To try again, add the recipe again.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={discard} disabled={pending}>
            {pending ? "Discarding…" : "Discard draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
