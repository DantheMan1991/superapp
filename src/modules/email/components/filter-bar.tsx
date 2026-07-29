import Link from "next/link";
import { cn } from "@/lib/utils";
import { filterChips, type MailViewQuery } from "../organise/filters";
import { mailHref } from "./mail-panes";
import { SaveSearchButton } from "./organise-controls";

/**
 * The three filters, and a way to keep the current view.
 *
 * Links, not buttons — a filtered view is a URL like every other state in this
 * module, so it can be linked, bookmarked and reached with the back button.
 * Toggling one clears the open message and the page position: the message you
 * were reading may not be in the filtered set, and page 4 of an unfiltered list
 * is not page 4 of a filtered one.
 */
export function FilterBar({
  view,
  params,
  mailboxId,
  folderName,
  canSave,
}: {
  view: MailViewQuery;
  params: Record<string, string | undefined>;
  mailboxId: string;
  folderName: string | null;
  canSave: boolean;
}) {
  const chips = filterChips(view);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={mailHref(params, {
            [chip.key]: chip.active ? undefined : "1",
            message: undefined,
            pos: undefined,
          })}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
            chip.active
              ? "border-brand bg-brand/15 font-medium text-brand-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          {chip.label}
        </Link>
      ))}

      {canSave && (
        <SaveSearchButton
          mailboxId={mailboxId}
          view={view}
          folderName={folderName}
        />
      )}
    </div>
  );
}
