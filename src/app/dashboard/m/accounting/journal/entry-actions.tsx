"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteDraftEntry,
  postDraftEntry,
  reversePostedEntry,
  voidPostedEntry,
} from "@/modules/accounting/actions";

type Confirm = "post" | "void" | "reverse" | "delete" | null;

const COPY: Record<Exclude<Confirm, null>, { title: string; body: string; cta: string }> = {
  post: {
    title: "Post this entry?",
    body: "Posting writes it into the books. It will show in reports immediately.",
    cta: "Post entry",
  },
  void: {
    title: "Void this entry?",
    body: "Voiding removes its effect from every report. The entry stays visible for the record. For entries in a closed or reconciled period, use Reverse instead.",
    cta: "Void entry",
  },
  reverse: {
    title: "Reverse this entry?",
    body: "Creates an offsetting entry dated today. Both entries stay in the books and cancel each other — the audit-clean way to undo.",
    cta: "Create reversal",
  },
  delete: {
    title: "Delete this draft?",
    body: "Drafts are not part of the books yet, so deleting is permanent and safe.",
    cta: "Delete draft",
  },
};

export function EntryActions({
  entryId,
  version,
  status,
  canPost,
  canMutatePosted,
}: {
  entryId: string;
  version: number;
  status: "draft" | "posted" | "void";
  /** Owner-only controls. */
  canPost: boolean;
  /** False when strict append-only mode or a closed period locks the entry. */
  canMutatePosted: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Confirm>(null);

  function run(kind: Exclude<Confirm, null>) {
    startTransition(async () => {
      const result =
        kind === "post"
          ? await postDraftEntry({ entryId, expectedVersion: version })
          : kind === "void"
            ? await voidPostedEntry({ entryId, expectedVersion: version })
            : kind === "reverse"
              ? await reversePostedEntry({ entryId })
              : await deleteDraftEntry({ entryId, expectedVersion: version });
      if ("error" in result) {
        toast.error(result.error);
        setConfirm(null);
        return;
      }
      toast.success(
        kind === "post"
          ? "Entry posted"
          : kind === "void"
            ? "Entry voided"
            : kind === "reverse"
              ? "Reversal created"
              : "Draft deleted",
      );
      setConfirm(null);
      if (kind === "delete") router.push("/dashboard/m/accounting/journal");
      router.refresh();
    });
  }

  if (!canPost) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <>
            <Button size="sm" onClick={() => setConfirm("post")}>
              Post
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirm("delete")}>
              Delete draft
            </Button>
          </>
        )}
        {status === "posted" && (
          <>
            {canMutatePosted && (
              <Button size="sm" variant="outline" onClick={() => setConfirm("void")}>
                Void
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setConfirm("reverse")}>
              Reverse
            </Button>
          </>
        )}
      </div>
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          {confirm && (
            <>
              <DialogHeader>
                <DialogTitle>{COPY[confirm].title}</DialogTitle>
                <DialogDescription>{COPY[confirm].body}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button onClick={() => run(confirm)} disabled={pending}>
                  {pending ? "Working…" : COPY[confirm].cta}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
