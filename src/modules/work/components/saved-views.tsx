"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bookmark, Lock, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { deleteViewAction, saveViewAction } from "../actions";
import { useWorkAction } from "./item-controls";

/**
 * Named views.
 *
 * A SAVED VIEW IS A STORED QUERY STRING, and opening one is a navigation.
 * Nothing here rebuilds a filter or reads a stored filter tree — the params go
 * into the URL exactly as they came out of it, and the page parses them the
 * same way it parses anything a person typed. That is the whole point of the
 * decision Documents made first: a saved view must never become a second query
 * builder.
 */

export interface SavedViewOption {
  id: string;
  name: string;
  params: string;
  scope: "tenant" | "private";
  mine: boolean;
}

export function SavedViews({
  views,
  currentParams,
}: {
  views: SavedViewOption[];
  /** The query string of what is on screen now, ready to be saved. */
  currentParams: string;
}) {
  const router = useRouter();
  const { pending, run } = useWorkAction();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"tenant" | "private">("tenant");

  function open(view: SavedViewOption) {
    router.push(
      view.params
        ? `/dashboard/m/work?${view.params}`
        : "/dashboard/m/work",
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <Bookmark className="mr-1 h-4 w-4" />
            Views
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {views.length === 0 && (
            <DropdownMenuItem disabled>Nothing saved yet</DropdownMenuItem>
          )}
          {views.map((view) => (
            <DropdownMenuItem
              key={view.id}
              onSelect={() => open(view)}
              className="flex items-center gap-2"
            >
              {view.scope === "private" ? (
                <Lock className="h-3 w-3 shrink-0" />
              ) : (
                <Users className="h-3 w-3 shrink-0" />
              )}
              <span className="flex-1 truncate">{view.name}</span>
              {/*
                Only its author gets a delete control, matching the policy — a
                button that always fails is worse than no button. The policy is
                still the guarantee; this is the courtesy.
              */}
              {view.mine && (
                <Trash2
                  className="h-3 w-3 shrink-0 opacity-60 hover:opacity-100"
                  role="button"
                  aria-label={`Delete ${view.name}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    run(() => deleteViewAction({ viewId: view.id }));
                  }}
                />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaving(true)}>
            Save this view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>
              Saving over a name you have used before replaces it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="work-view-name">Name</Label>
              <Input
                id="work-view-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Overdue on site"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="work-view-scope">Who can use it</Label>
              <Select
                value={scope}
                onValueChange={(value) =>
                  setScope(value as "tenant" | "private")
                }
              >
                <SelectTrigger id="work-view-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tenant">Everyone</SelectItem>
                  <SelectItem value="private">Only me</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || name.trim().length === 0}
              onClick={() =>
                run(async () => {
                  const result = await saveViewAction({
                    name: name.trim(),
                    params: currentParams,
                    scope,
                  });
                  if ("ok" in result) {
                    setName("");
                    setSaving(false);
                  }
                  return result;
                })
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
