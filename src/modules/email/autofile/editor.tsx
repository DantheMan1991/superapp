"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteAutofileRuleAction,
  saveAutofileRuleAction,
} from "./actions";

export interface EditorAutofileRule {
  id: string;
  name: string;
  matchMailboxId: string | null;
  matchFrom: string;
  destinationFolderId: string | null;
  isEnabled: boolean;
  lastError: string;
  filedCount: number;
  lastRunAt: Date | null;
}

export interface FolderChoice {
  id: string;
  label: string;
}

/**
 * Automatic filing, in the reading pane.
 *
 * Same shape as the rules editor, the signature form and the templates manager:
 * it takes the pane rather than floating over it.
 *
 * THE COPY HERE IS DOING SECURITY WORK, not marketing. Everything else in this
 * module keeps somebody's mail to themselves; this is the one feature that
 * deliberately publishes it, on a schedule, with nobody watching. Somebody who
 * sets one of these up without understanding that is the failure case, so the
 * consequence is stated once at the top in plain words rather than implied by a
 * field label.
 */
export function AutofileEditor({
  mailboxId,
  rules,
  folders,
  destinationFolders,
  closeHref,
}: {
  mailboxId: string;
  rules: EditorAutofileRule[];
  /** JMAP folders in this mailbox, for the "only in" picker. */
  folders: { id: string; name: string }[];
  /** Documents folders the SWEEP can actually write to. */
  destinationFolders: FolderChoice[];
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<EditorAutofileRule | null>(null);
  const [name, setName] = useState("");
  const [matchMailboxId, setMatchMailboxId] = useState<string>("");
  const [matchFrom, setMatchFrom] = useState("");
  const [destination, setDestination] = useState<string>("");
  const [enabled, setEnabled] = useState(true);

  function open(rule: EditorAutofileRule | null) {
    setEditing(
      rule ?? {
        id: "",
        name: "",
        matchMailboxId: null,
        matchFrom: "",
        destinationFolderId: null,
        isEnabled: true,
        lastError: "",
        filedCount: 0,
        lastRunAt: null,
      },
    );
    setName(rule?.name ?? "");
    setMatchMailboxId(rule?.matchMailboxId ?? "");
    setMatchFrom(rule?.matchFrom ?? "");
    setDestination(rule?.destinationFolderId ?? "");
    setEnabled(rule?.isEnabled ?? true);
  }

  function save() {
    if (!editing) return;
    startTransition(async () => {
      const result = await saveAutofileRuleAction({
        ...(editing.id ? { id: editing.id } : {}),
        mailboxId,
        name,
        matchMailboxId: matchMailboxId || null,
        matchFrom,
        destinationFolderId: destination || null,
        isEnabled: enabled,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Filing rule saved.");
      setEditing(null);
      router.refresh();
    });
  }

  function remove(rule: EditorAutofileRule) {
    startTransition(async () => {
      const result = await deleteAutofileRuleAction({ id: rule.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted "${rule.name}". Anything already filed stays in Documents.`);
      if (editing?.id === rule.id) setEditing(null);
      router.refresh();
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="text-sm font-medium">Automatic filing</span>
        <Link
          href={closeHref}
          className="ml-auto text-sm text-muted-foreground hover:text-foreground"
        >
          Close
        </Link>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        <p className="flex gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
          <span className="text-muted-foreground">
            <span className="font-medium text-foreground">
              Filed attachments are visible to everyone in the business.
            </span>{" "}
            A rule copies matching messages and their attachments into Documents
            automatically, with nobody checking each one. Only your own mailbox
            can be filed this way, and only you can set this up.
          </span>
        </p>

        {!editing && (
          <>
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No filing rules. A rule is useful when the same sender keeps
                emailing you paperwork — supplier invoices, signed orders.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {rules.map((rule) => (
                  <li key={rule.id} className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => open(rule)}
                    >
                      <span className="block truncate text-sm font-medium">
                        {rule.name}
                        {!rule.isEnabled && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            paused
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {rule.filedCount} filed
                        {rule.lastError ? ` · ${rule.lastError}` : ""}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      aria-label={`Delete ${rule.name}`}
                      onClick={() => remove(rule)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button size="sm" disabled={pending} onClick={() => open(null)}>
              <Plus className="size-4" />
              New filing rule
            </Button>
          </>
        )}

        {editing && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="af-name" className="text-xs text-muted-foreground">
                Name
              </label>
              <Input
                id="af-name"
                value={name}
                maxLength={80}
                placeholder="Supplier invoices"
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="af-from" className="text-xs text-muted-foreground">
                From address contains
              </label>
              <Input
                id="af-from"
                value={matchFrom}
                maxLength={200}
                placeholder="accounts@supplier.co.uk"
                onChange={(e) => setMatchFrom(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="af-folder" className="text-xs text-muted-foreground">
                Only in this mail folder
              </label>
              <select
                id="af-folder"
                value={matchMailboxId}
                onChange={(e) => setMatchMailboxId(e.target.value)}
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="">Inbox</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              {/* The action refuses this combination, but saying so here saves
                  somebody discovering it by pressing Save. */}
              <p className="text-xs text-muted-foreground">
                Set a sender, a folder, or both. A rule with neither would file
                everything.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="af-dest" className="text-xs text-muted-foreground">
                File into
              </label>
              <select
                id="af-dest"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="">The Documents inbox</option>
                {destinationFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
              {/* Owners-only folders are absent from this list rather than
                  greyed out, because filing runs with no one signed in and
                  genuinely cannot reach them — see autofile/load.ts. */}
              <p className="text-xs text-muted-foreground">
                Owners-only folders aren&apos;t listed: filing runs in the
                background with nobody signed in, so it can&apos;t open them.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Filing is on
            </label>

            <p className="text-xs text-muted-foreground">
              Only mail arriving from now on is filed — turning a rule on
              doesn&apos;t reach back through what is already in the mailbox.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <Button onClick={save} disabled={pending} size="sm">
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save rule
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
