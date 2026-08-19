"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Link2, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { MemberOption, WorkRowView } from "../core/row";
import { AssigneeControl, StateControl, useWorkAction } from "./item-controls";
import {
  attachLinkAction,
  detachLinkAction,
  searchLinkTargetsAction,
  updateItemAction,
} from "../actions";

/**
 * One piece of work, opened from anywhere.
 *
 * URL-DRIVEN (`?item=<id>`), like every other view state in this module. That
 * is not tidiness: it is what gives a work item a linkable address, which is
 * what lets Work be a CONTRIBUTOR to entity-links at all. A sheet opened by
 * component state would have no href for another module's chip to point at.
 */

export interface SheetLink {
  linkId: string;
  entityType: string;
  /** Null when the record is gone, or hidden from this reader. */
  label: string | null;
  sublabel?: string;
  href?: string;
}

export interface SheetItem extends WorkRowView {
  description: string;
}

export function ItemSheet({
  item,
  links,
  members,
  backHref,
}: {
  item: SheetItem | null;
  links: SheetLink[];
  members: MemberOption[];
  backHref: string;
}) {
  const router = useRouter();
  const { pending, run } = useWorkAction();

  return (
    <Sheet
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) router.push(backHref);
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-8 text-left">{item.title}</SheetTitle>
            </SheetHeader>
            {/*
              Keyed on the item id so opening a different row starts from that
              row's values. The alternative is adjusting state during render by
              comparing against the previous prop; a key is the version of that
              with no effect and no comparison.
            */}
            <ItemFields
              key={item.id}
              item={item}
              links={links}
              members={members}
              pending={pending}
              run={run}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ItemFields({
  item,
  links,
  members,
  pending,
  run,
}: {
  item: SheetItem;
  links: SheetLink[];
  members: MemberOption[];
  pending: boolean;
  run: (action: () => Promise<{ ok: true } | { error: string }>) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [dueOn, setDueOn] = useState(item.dueOn ?? "");
  const [startsOn, setStartsOn] = useState(item.startsOn ?? "");

  function save() {
    run(() =>
      updateItemAction({
        itemId: item.id,
        title: title.trim(),
        description,
        dueOn: dueOn || null,
        startsOn: startsOn || null,
      }),
    );
  }

  return (
    <div className="space-y-5 px-4 pb-6">
      <div className="space-y-2">
        <Label htmlFor="work-item-title">Title</Label>
        <Input
          id="work-item-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="work-item-notes">Notes</Label>
        <Textarea
          id="work-item-notes"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="work-item-starts">Start</Label>
          <Input
            id="work-item-starts"
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="work-item-due">Due</Label>
          <Input
            id="work-item-due"
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
          />
        </div>
      </div>

      <Button size="sm" onClick={save} disabled={pending || !title.trim()}>
        Save
      </Button>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <StateControl row={item} pending={pending} run={run} />
        <AssigneeControl
          row={item}
          members={members}
          pending={pending}
          run={run}
        />
      </div>

      <LinkSection itemId={item.id} links={links} pending={pending} run={run} />
    </div>
  );
}

/**
 * What this work is about.
 *
 * A link whose record does not resolve renders as a DANGLING chip rather than
 * disappearing: the row exists, and hiding it would tell the reader nothing was
 * ever attached. It resolves to null for two different reasons — deleted, or
 * refused by RLS — and this deliberately does not say which, because
 * distinguishing them would confirm that a record they cannot see exists.
 */
function LinkSection({
  itemId,
  links,
  pending,
  run,
}: {
  itemId: string;
  links: SheetLink[];
  pending: boolean;
  run: (action: () => Promise<{ ok: true } | { error: string }>) => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [groups, setGroups] = useState<
    {
      extensionSlug: string;
      entityType: string;
      pluralLabel: string;
      results: { entityId: string; label: string; sublabel?: string }[];
    }[]
  >([]);

  async function search() {
    const trimmed = query.trim();
    if (!trimmed) {
      setGroups([]);
      return;
    }
    setSearching(true);
    // `itemId` so this item is not offered as its own subject. The server
    // refuses a self-link regardless; this stops the choice appearing.
    const result = await searchLinkTargetsAction({ query: trimmed, itemId });
    setSearching(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    setGroups(result.data?.groups ?? []);
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Link2 className="h-4 w-4" />
        What this is about
      </h3>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing attached yet.</p>
      ) : (
        <ul className="space-y-1">
          {links.map((link) => (
            <li key={link.linkId} className="flex items-center gap-2">
              <Badge variant="outline" className="max-w-full gap-1">
                <span className="truncate">
                  {link.label ?? "A record you cannot see"}
                </span>
              </Badge>
              {link.href && link.label && (
                <a
                  href={link.href}
                  className="text-xs text-muted-foreground underline"
                >
                  open
                </a>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={pending}
                aria-label={`Detach ${link.label ?? "record"}`}
                onClick={() =>
                  run(() => detachLinkAction({ linkId: link.linkId }))
                }
              >
                <X className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Attach a customer, invoice, file…"
          className="h-8"
          aria-label="Search records to attach"
        />
        <Button type="submit" size="sm" variant="outline" disabled={searching}>
          {searching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </Button>
      </form>

      {groups.map((group) => (
        <div key={`${group.extensionSlug}:${group.entityType}`} className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {group.pluralLabel}
          </p>
          <ul className="space-y-1">
            {group.results.map((result) => (
              <li key={result.entityId}>
                <button
                  type="button"
                  disabled={pending}
                  className="w-full rounded border px-2 py-1 text-left text-sm hover:bg-accent"
                  onClick={() =>
                    run(async () => {
                      const outcome = await attachLinkAction({
                        itemId,
                        extensionSlug: group.extensionSlug,
                        entityType: group.entityType,
                        entityId: result.entityId,
                      });
                      if ("ok" in outcome) {
                        setQuery("");
                        setGroups([]);
                      }
                      return outcome;
                    })
                  }
                >
                  {result.label}
                  {result.sublabel && (
                    <span className="block text-xs text-muted-foreground">
                      {result.sublabel}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
