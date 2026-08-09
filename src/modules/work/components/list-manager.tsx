"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Lock, Pencil, Plus, Users } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkVisibility } from "@/lib/work/vocabulary";
import { WORK_COLORS, WORK_COLOR_CLASSES, type WorkColor } from "../core/colors";
import {
  createListAction,
  setListArchivedAction,
  updateListAction,
} from "../actions";

/**
 * Work lists, and who can see them.
 *
 * One screen rather than a page per list, because the question somebody comes
 * here with is comparative — "which of these can the whole team see?" — and
 * that is unanswerable if each list's visibility lives on its own screen.
 */

export interface ListRowView {
  id: string;
  name: string;
  color: string;
  visibility: WorkVisibility;
  isDefault: boolean;
  archived: boolean;
}

const VISIBILITY_COPY: Record<WorkVisibility, string> = {
  members: "Everyone in the workspace",
  owners: "Owners only",
};

export function ListManager({
  lists,
  isOwner,
}: {
  lists: ListRowView[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ListRowView | null>(null);
  const [creating, setCreating] = useState(false);

  function run(action: () => Promise<{ ok: true } | { error: string }>) {
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setEditing(null);
      setCreating(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Lists</h1>
          <p className="text-sm text-muted-foreground">
            A list is how work is grouped, and the only thing that decides who
            can see it.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-4 w-4" />
          New list
        </Button>
      </div>

      <ul className="divide-y rounded-lg border">
        {lists.map((list) => (
          <li key={list.id} className="flex flex-wrap items-center gap-3 p-3">
            <span
              className={`h-3 w-3 shrink-0 rounded-full ${
                WORK_COLOR_CLASSES[list.color as WorkColor] ?? "bg-slate-400"
              }`}
            />
            <span className="min-w-[8rem] flex-1 font-medium">
              {list.name}
              {list.archived && (
                <span className="ml-2 text-xs text-muted-foreground">
                  archived
                </span>
              )}
            </span>
            {list.isDefault && <Badge variant="secondary">Default</Badge>}
            <Badge variant="outline" className="gap-1">
              {list.visibility === "owners" ? (
                <Lock className="h-3 w-3" />
              ) : (
                <Users className="h-3 w-3" />
              )}
              {VISIBILITY_COPY[list.visibility]}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(list)}
              aria-label={`Edit ${list.name}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {/* The default list has no archive control at all: the action
                refuses it, and offering a button that always fails is worse
                than not offering one. */}
            {!list.isDefault && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={list.archived ? "Restore" : "Archive"}
                onClick={() =>
                  run(() =>
                    setListArchivedAction({
                      listId: list.id,
                      archived: !list.archived,
                    }),
                  )
                }
              >
                {list.archived ? (
                  <ArchiveRestore className="h-4 w-4" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <ListDialog
        open={creating}
        onOpenChange={setCreating}
        title="New list"
        description="Visible to everyone in the workspace unless you restrict it."
        isOwner={isOwner}
        pending={pending}
        initial={{ name: "", color: "slate", visibility: "members" }}
        onSubmit={(values) => run(() => createListAction(values))}
      />

      <ListDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Edit list"
        description="Changing who can see a list changes who can see its work."
        isOwner={isOwner}
        pending={pending}
        initial={
          editing
            ? {
                name: editing.name,
                color: editing.color as WorkColor,
                visibility: editing.visibility,
              }
            : { name: "", color: "slate", visibility: "members" }
        }
        onSubmit={(values) =>
          editing &&
          run(() => updateListAction({ listId: editing.id, ...values }))
        }
      />
    </div>
  );
}

interface ListValues {
  name: string;
  color: WorkColor;
  visibility: WorkVisibility;
}

function ListDialog({
  open,
  onOpenChange,
  title,
  description,
  isOwner,
  pending,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  isOwner: boolean;
  pending: boolean;
  initial: ListValues;
  onSubmit: (values: ListValues) => void;
}) {
  // Keyed on `open` so each opening starts from the row's own values rather
  // than the previous dialog's — state adjusted during render would be the
  // alternative, and a key is the version of that with no effect in it.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent key={String(open)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ListFields
          isOwner={isOwner}
          pending={pending}
          initial={initial}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function ListFields({
  isOwner,
  pending,
  initial,
  onSubmit,
}: {
  isOwner: boolean;
  pending: boolean;
  initial: ListValues;
  onSubmit: (values: ListValues) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState<WorkColor>(initial.color);
  const [visibility, setVisibility] = useState<WorkVisibility>(
    initial.visibility,
  );

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="work-list-name">Name</Label>
          <Input
            id="work-list-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Field work"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="work-list-color">Colour</Label>
          <Select
            value={color}
            onValueChange={(value) => setColor(value as WorkColor)}
          >
            <SelectTrigger id="work-list-color">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORK_COLORS.map((option) => (
                <SelectItem key={option} value={option}>
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-3 w-3 rounded-full ${WORK_COLOR_CLASSES[option]}`}
                    />
                    {option}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="work-list-visibility">Who can see it</Label>
          <Select
            value={visibility}
            onValueChange={(value) => setVisibility(value as WorkVisibility)}
            disabled={!isOwner}
          >
            <SelectTrigger id="work-list-visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="members">
                {VISIBILITY_COPY.members}
              </SelectItem>
              <SelectItem value="owners">{VISIBILITY_COPY.owners}</SelectItem>
            </SelectContent>
          </Select>
          {!isOwner && (
            <p className="text-xs text-muted-foreground">
              Only an owner can restrict a list.
            </p>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={pending || name.trim().length === 0}
          onClick={() => onSubmit({ name: name.trim(), color, visibility })}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
