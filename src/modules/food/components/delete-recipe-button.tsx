"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
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
import { deleteRecipeAction } from "../actions";

/** Delete a recipe, after asking by name. Its photo goes with it. */
export function DeleteRecipeButton({ recipeId, title }: { recipeId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const outcome = await deleteRecipeAction({ recipeId });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setOpen(false);
      toast.success("Recipe deleted");
      router.push("/personal/m/food/recipes");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Trash2 aria-hidden /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {title}?</DialogTitle>
          <DialogDescription>The recipe and its photo are deleted. This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={remove} disabled={pending}>
            {pending ? "Deleting…" : "Delete recipe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
