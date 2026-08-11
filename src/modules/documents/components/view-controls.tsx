"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bookmark, Loader2, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SavedViewQuery } from "../saved-views";
import {
  createSavedViewAction,
  deleteSavedViewAction,
} from "../view-actions";

export interface SavedViewItem {
  id: string;
  name: string;
  scope: string;
  href: string;
  createdByClerkUserId: string;
}

/** Name the filter you just built. */
export function SaveViewButton({
  query,
  suggestedName,
}: {
  query: SavedViewQuery;
  /** What the filter reads as, so the field is rarely empty on open. */
  suggestedName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggestedName);
  const [scope, setScope] = useState<"tenant" | "private">("tenant");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await createSavedViewAction({ name, scope, query });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("View saved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Bookmark className="size-4" />
        Save this view
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>
              Saves the filters, not the results — the view always shows what
              matches today.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="view-name">Name</Label>
              <Input
                id="view-name"
                value={name}
                maxLength={60}
                placeholder="Open permits"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Who sees it</Label>
              <Select
                value={scope}
                onValueChange={(v) => setScope(v as "tenant" | "private")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tenant">Everyone in the business</SelectItem>
                  <SelectItem value="private">Only me</SelectItem>
                </SelectContent>
              </Select>
              {/* Said plainly, because "only me" could otherwise be read as a
                  security control. It hides the shortcut, not the files. */}
              <p className="text-xs text-muted-foreground">
                A private view hides the shortcut from colleagues. It does not
                hide the files — those follow their folder&apos;s own rules.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || name.trim().length === 0} onClick={save}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The saved-view shortcuts, with delete for the ones this caller may remove. */
export function SavedViewsStrip({
  views,
  activeHref,
  canDelete,
}: {
  views: SavedViewItem[];
  activeHref: string;
  /** Ids this caller may delete — their own, or anything if they're an owner. */
  canDelete: (view: SavedViewItem) => boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (views.length === 0) return null;

  function remove(view: SavedViewItem) {
    startTransition(async () => {
      const result = await deleteSavedViewAction({ viewId: view.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("View deleted");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        Saved views
      </span>
      {views.map((view) => {
        const active = view.href === activeHref;
        return (
          <span
            key={view.id}
            className={cn(
              "inline-flex items-center rounded-full border text-xs",
              active
                ? "border-module-accent bg-secondary"
                : "border-border",
            )}
          >
            <Link href={view.href} className="py-1 pl-3 pr-1 hover:underline">
              {view.name}
              {view.scope === "private" && (
                <span className="ml-1 text-muted-foreground">(private)</span>
              )}
            </Link>
            {canDelete(view) && (
              <button
                type="button"
                aria-label={`Delete view ${view.name}`}
                disabled={pending}
                onClick={() => remove(view)}
                className="px-1.5 py-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
