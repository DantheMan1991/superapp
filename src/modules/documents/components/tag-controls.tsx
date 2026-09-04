"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { TAG_NAME_MAX, TAGS_PER_DOCUMENT_MAX } from "../core/tags";
import {
  createTagAction,
  deleteTagAction,
  setDocumentTagsAction,
  updateTagAction,
} from "../tag-actions";

export interface TagChoice {
  id: string;
  slug: string;
  name: string;
  version: number;
}

/**
 * Pick a document's tags.
 *
 * Selection is held locally and written once on Save, so toggling six tags is
 * one audit entry and one round trip rather than six of each.
 */
export function TagPickerDialog({
  open,
  onOpenChange,
  documentId,
  fileName,
  tags,
  selected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  fileName: string;
  tags: TagChoice[];
  selected: readonly string[];
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>([...selected]);
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();

  function toggle(slug: string) {
    setChosen((prev) =>
      prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : prev.length >= TAGS_PER_DOCUMENT_MAX
          ? prev
          : [...prev, slug],
    );
  }

  /**
   * Creating from inside the picker keeps the registry the single source of
   * truth — the new tag is a real registry entry before it can be selected,
   * never a free-text string attached to one document.
   */
  function createAndSelect() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createTagAction({ name, color: "" });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const slug = result.data!.slug;
      setChosen((prev) => (prev.includes(slug) ? prev : [...prev, slug]));
      setNewName("");
      router.refresh();
    });
  }

  function save() {
    startTransition(async () => {
      const result = await setDocumentTagsAction({ documentId, slugs: chosen });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Tags saved");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tags</DialogTitle>
          <DialogDescription>{fileName}</DialogDescription>
        </DialogHeader>

        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tags yet. Create the first one below.
          </p>
        ) : (
          <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
            {tags.map((tag) => {
              const on = chosen.includes(tag.slug);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(tag.slug)}
                  className="rounded-full"
                >
                  <Badge
                    variant={on ? "default" : "outline"}
                    className={cn("cursor-pointer gap-1 font-normal")}
                  >
                    {on && <Check className="size-3" />}
                    {tag.name}
                  </Badge>
                </button>
              );
            })}
          </div>
        )}

        <div className="space-y-2 border-t pt-4">
          <Label htmlFor={`new-tag-${documentId}`}>Create a tag</Label>
          <div className="flex gap-2">
            <Input
              id={`new-tag-${documentId}`}
              value={newName}
              maxLength={TAG_NAME_MAX}
              placeholder="As-built"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                createAndSelect();
              }}
            />
            <Button
              variant="outline"
              disabled={pending || newName.trim().length === 0}
              onClick={createAndSelect}
            >
              <Plus className="size-4" />
              Add
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={save}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The registry manager on /tags.
 *
 * Renaming changes the display name only — the slug is the tag's identity and
 * every document stores it, which is exactly why a rename is a one-row update
 * and never a sweep.
 */
export function TagManager({
  tags,
  counts,
  isOwner,
  canWrite = true,
}: {
  tags: TagChoice[];
  counts: Record<string, number>;
  isOwner: boolean;
  /** `roleMayWrite(role)`. False leaves the tags and their counts and drops every control. */
  canWrite?: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState("");
  const [editing, setEditing] = useState<TagChoice | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirming, setConfirming] = useState<TagChoice | null>(null);
  const [pending, startTransition] = useTransition();

  function run(
    fn: () => Promise<{ ok: true; data?: unknown } | { error: string }>,
    msg: string,
  ) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(msg);
      setEditing(null);
      setConfirming(null);
      setCreating("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Creating a tag is the only write at the top of this page. */}
      {canWrite && (
      <div className="flex gap-2">
        <Input
          value={creating}
          maxLength={TAG_NAME_MAX}
          placeholder="New tag name"
          aria-label="New tag name"
          className="max-w-xs"
          onChange={(e) => setCreating(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || creating.trim().length === 0) return;
            e.preventDefault();
            run(() => createTagAction({ name: creating, color: "" }), "Tag created");
          }}
        />
        <Button
          disabled={pending || creating.trim().length === 0}
          onClick={() =>
            run(() => createTagAction({ name: creating, color: "" }), "Tag created")
          }
        >
          <Plus className="size-4" />
          Create
        </Button>
      </div>
      )}

      {tags.length === 0 ? (
        <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          No tags yet. Tags are a shared vocabulary for the whole business —
          &ldquo;as-built&rdquo;, &ldquo;permit&rdquo;, &ldquo;signed&rdquo;.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-3 px-4 py-3">
              <Badge variant="outline" className="font-normal">
                {tag.name}
              </Badge>
              <code className="text-xs text-muted-foreground">{tag.slug}</code>
              <span className="ml-auto text-xs text-muted-foreground">
                {counts[tag.slug] ?? 0} file
                {(counts[tag.slug] ?? 0) === 1 ? "" : "s"}
              </span>
              {canWrite && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(tag);
                    setDraftName(tag.name);
                  }}
                >
                  Rename
                </Button>
              )}
              {canWrite && isOwner && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${tag.name}`}
                  onClick={() => setConfirming(tag)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={() => setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename tag</DialogTitle>
            <DialogDescription>
              Only the display name changes. Files keep their link to this tag,
              so nothing is re-filed and no search stops working.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tag-rename">Name</Label>
            <Input
              id="tag-rename"
              value={draftName}
              maxLength={TAG_NAME_MAX}
              onChange={(e) => setDraftName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                editing &&
                run(
                  () =>
                    updateTagAction({
                      tagId: editing.id,
                      expectedVersion: editing.version,
                      name: draftName,
                    }),
                  "Tag renamed",
                )
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming !== null} onOpenChange={() => setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirming?.name}?</DialogTitle>
            <DialogDescription>
              This removes the tag from{" "}
              {confirming ? (counts[confirming.slug] ?? 0) : 0} file(s). The
              files themselves are untouched, and this cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                confirming &&
                run(
                  () =>
                    deleteTagAction({
                      tagId: confirming.id,
                      expectedVersion: confirming.version,
                    }),
                  "Tag deleted",
                )
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Delete tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
