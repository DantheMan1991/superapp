"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, FolderPlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { describeView, type MailViewQuery } from "../organise/filters";
import {
  createFolderAction,
  deleteSearchAction,
  saveSearchAction,
} from "../organise-actions";

/**
 * The small client controls: keep this view, make a folder, drop a saved search.
 *
 * Each is a dialog or a button rather than an inline form, because all three are
 * rare actions sitting next to things people do constantly, and an always-open
 * text field beside a folder list is a permanent invitation to type in the
 * wrong box.
 */

export function SaveSearchButton({
  mailboxId,
  view,
  folderName,
}: {
  mailboxId: string;
  view: MailViewQuery;
  folderName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Prefilled from what the view actually is, so nobody has to invent a name
  // for "unread, flagged, in Inbox".
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  const suggestion = describeView(view, folderName);

  function save() {
    const chosen = (name.trim() || suggestion).slice(0, 60);
    startTransition(async () => {
      const result = await saveSearchAction({ mailboxId, name: chosen, query: view });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Saved “${chosen}”.`);
      setOpen(false);
      setName("");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <BookmarkPlus className="size-3.5" />
        Save this view
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>
              It appears in your folder rail as a link. Saved views are yours
              alone — they point at folders in your own mailbox, which mean
              nothing in a colleague&apos;s.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={suggestion}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
          <Button onClick={save} disabled={pending} size="sm">
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteSearchButton({ searchId }: { searchId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label="Remove saved view"
      disabled={pending}
      className="rounded-sm p-0.5 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100 disabled:opacity-30"
      onClick={(e) => {
        // The row is a link; removing must not navigate into the view being
        // removed.
        e.preventDefault();
        e.stopPropagation();
        startTransition(async () => {
          const result = await deleteSearchAction({ searchId });
          if ("error" in result) toast.error(result.error);
          else router.refresh();
        });
      }}
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <X className="size-3" />
      )}
    </button>
  );
}

export function NewFolderButton({ mailboxId }: { mailboxId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function create() {
    const chosen = name.trim();
    if (chosen.length === 0) return;
    startTransition(async () => {
      const result = await createFolderAction({
        mailboxId,
        name: chosen,
        parentId: null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // Said plainly: the folder is the mail server's, so it turns up in
      // Outlook and on their phone too. That is the feature, not a surprise.
      toast.success(`Created “${chosen}” — it'll appear in your other mail apps too.`);
      setOpen(false);
      setName("");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <FolderPlus className="size-3.5" />
        New folder
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Created on the mail server, so it appears everywhere you read this
              mailbox.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Quotes"
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <Button onClick={create} disabled={pending || name.trim().length === 0} size="sm">
            {pending && <Loader2 className="size-4 animate-spin" />}
            Create
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
