"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Search, X } from "lucide-react";
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
import type { SearchGroup } from "@/lib/mail-extensions/resolve";
import { linkThreadAction, searchLinkTargetsAction, unlinkThreadAction } from "../link-actions";
import { linkIcon } from "./link-icons";

/**
 * The "Attach to…" picker, and the button that removes a link.
 *
 * The house pattern: `useTransition` + `sonner` + `router.refresh()`, no
 * optimistic state. Attaching does real work — it fetches a message, writes
 * blobs and inserts rows — so guessing at the outcome would mean showing a chip
 * for a copy that might not exist.
 */

/** Long enough that typing does not fire a query per keystroke. */
const DEBOUNCE_MS = 250;

export function AttachToButton({
  mailboxId,
  emailId,
  destinationLabel,
}: {
  mailboxId: string;
  emailId: string;
  /** "the Documents inbox" — named up front, never after the fact. */
  destinationLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, startTransition] = useTransition();

  // No state is set in the effect BODY — only inside the debounce callback and
  // only after the await. An empty box is handled by rendering rather than by
  // clearing state, which is what keeps this out of a cascading-render loop.
  const term = query.trim();
  useEffect(() => {
    if (!open || term.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setSearching(true);
      const result = await searchLinkTargetsAction({ query: term });
      // A reply that arrives after the query moved on must not overwrite the
      // newer results — the classic out-of-order search bug.
      if (cancelled) return;
      setSearching(false);
      setGroups("error" in result ? [] : (result.data ?? []));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, term]);

  function attach(entityType: string, entityId: string) {
    startTransition(async () => {
      const result = await linkThreadAction({
        mailboxId,
        emailId,
        entityType,
        entityId,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const data = result.data;
      const parts = [
        data?.alreadyFiled
          ? "Attached — a copy was already filed."
          : `Attached. A copy is in ${data?.destinationLabel ?? "Documents"}.`,
      ];
      if (data && data.attachmentsFiled > 0) {
        parts.push(
          `${data.attachmentsFiled} attachment${data.attachmentsFiled === 1 ? "" : "s"} filed too.`,
        );
      }
      if (data && data.attachmentsSkipped > 0) {
        // Said out loud rather than swallowed: believing a file was kept when it
        // was not is worse than knowing it was skipped. It is still inside the
        // filed .eml either way.
        parts.push(
          `${data.attachmentsSkipped} couldn't be filed separately — they're still inside the email.`,
        );
      }
      toast.success(parts.join(" "));
      setOpen(false);
      setQuery("");
      setGroups(null);
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Link2 className="size-3.5" />
        Attach to…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Attach this conversation</DialogTitle>
            <DialogDescription>
              A copy of this email — and its attachments — is filed into{" "}
              {destinationLabel} so the rest of the business can read it. Your
              mailbox stays private. The copy is a snapshot of this message as it
              is now; a later reply is a new message, not an update to this one.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search invoices, bills, customers, files…"
              className="pl-9"
            />
          </div>

          <div className="max-h-80 overflow-y-auto">
            {term.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                Start typing to find the record this email is about.
              </p>
            ) : searching ? (
              <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Searching…
              </p>
            ) : groups && groups.length > 0 ? (
              <div className="space-y-4">
                {groups.map((group) => {
                  const Icon = linkIcon(group.icon);
                  return (
                    <div key={`${group.extensionSlug}:${group.entityType}`}>
                      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Icon className="size-3.5" />
                        {group.pluralLabel}
                      </p>
                      <div className="divide-y rounded-md border">
                        {group.results.map((entity) => (
                          <button
                            key={entity.entityId}
                            type="button"
                            disabled={pending}
                            // min-w-0 on the button and w-full on the spans is
                            // what makes `truncate` mean anything here: in a
                            // flex column, items-start sizes children to their
                            // content, so a long file name overflows the dialog
                            // instead of ellipsising. Mail is full of long file
                            // names.
                            className="flex w-full min-w-0 flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                            onClick={() =>
                              attach(entity.entityType, entity.entityId)
                            }
                          >
                            <span className="w-full truncate font-medium">
                              {entity.label}
                            </span>
                            {entity.sublabel && (
                              <span className="w-full truncate text-xs text-muted-foreground">
                                {entity.sublabel}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                Nothing matched that.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RemoveLinkButton({ linkId }: { linkId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      aria-label="Remove attachment"
      disabled={pending}
      className="rounded-sm p-0.5 opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
      onClick={() =>
        startTransition(async () => {
          const result = await unlinkThreadAction({ linkId });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          // Named precisely. Removing a link is not deleting the filed copy, and
          // a toast that said "removed" would let somebody believe it was.
          toast.success("Detached. The filed copy is still in Documents.");
          router.refresh();
        })
      }
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <X className="size-3.5" />
      )}
    </button>
  );
}
