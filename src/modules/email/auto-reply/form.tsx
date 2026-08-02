"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SharedMailboxNotice } from "../components/shared-mailbox-notice";
import { saveAutoReplyAction } from "./actions";
import {
  autoReplyState,
  MAX_BODY,
  validateAutoReply,
  type AutoReplyDraft,
} from "./validate";

/**
 * The out-of-office form, in the reading pane.
 *
 * Same choice the composer made: it takes the pane rather than floating over
 * it, so the inbox stays visible behind the decision.
 *
 * Dates are `datetime-local`, which means the browser hands back wall-clock
 * time with no zone. That is exactly right here — "back on Monday the 18th"
 * is a statement about the person's calendar — and it is converted to an
 * absolute instant on submit, because the mail server compares against UTC.
 */
export function AutoReplyForm({
  mailboxId,
  initial,
  closeHref,
  unavailable,
  sharedAddress,
}: {
  mailboxId: string;
  initial: AutoReplyDraft;
  closeHref: string;
  /** The mail server would not say what the current setting is. */
  unavailable: boolean;
  /**
   * Set when this is a DELEGATED mailbox, to the address it belongs to. One
   * auto-reply exists per mailbox, so on a shared box this is everybody's.
   */
  sharedAddress?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<AutoReplyDraft>(initial);

  const problem = validateAutoReply(draft, new Date());
  const state = autoReplyState(draft, new Date());

  function submit() {
    if (problem) {
      toast.error(problem.message);
      return;
    }
    startTransition(async () => {
      const result = await saveAutoReplyAction({
        mailboxId,
        isEnabled: draft.isEnabled,
        fromDate: toInstant(draft.fromDate),
        toDate: toInstant(draft.toDate),
        subject: draft.subject,
        textBody: draft.textBody,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(draft.isEnabled ? "Auto-reply is on." : "Auto-reply is off.");
      router.refresh();
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <h2 className="text-sm font-medium">Auto-reply</h2>
        <Link
          href={closeHref}
          className="ml-auto text-sm text-muted-foreground hover:text-foreground"
        >
          Close
        </Link>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
        {sharedAddress && (
          <SharedMailboxNotice address={sharedAddress} what="auto-reply" />
        )}
        {unavailable && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            The mail server didn&apos;t say what the current setting is, so this
            form is showing an empty one. Saving it will overwrite whatever is
            actually there.
          </p>
        )}

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={draft.isEnabled}
            onChange={(e) =>
              setDraft({ ...draft, isEnabled: e.currentTarget.checked })
            }
            className="mt-0.5 size-4 accent-current"
          />
          <span>
            <span className="block text-sm font-medium">
              Reply automatically to incoming mail
            </span>
            <span className="block text-xs text-muted-foreground">
              The mail server sends these, so they go out whether or not anyone
              is signed in.
            </span>
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="away-from">Start</Label>
            <Input
              id="away-from"
              type="datetime-local"
              value={draft.fromDate ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, fromDate: e.currentTarget.value || null })
              }
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to start now.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="away-to">End</Label>
            <Input
              id="away-to"
              type="datetime-local"
              value={draft.toDate ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, toDate: e.currentTarget.value || null })
              }
            />
            <p className="text-xs text-muted-foreground">
              {/* The honest warning. Everything else on this form is
                  recoverable; forgetting an end date is the one that keeps
                  answering customers for a fortnight. */}
              Leave blank and it runs until you turn it off.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="away-subject">Subject</Label>
          <Input
            id="away-subject"
            value={draft.subject}
            maxLength={200}
            placeholder="Out of the office"
            onChange={(e) => setDraft({ ...draft, subject: e.currentTarget.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="away-body">Message</Label>
          <textarea
            id="away-body"
            value={draft.textBody}
            maxLength={MAX_BODY}
            rows={8}
            placeholder="Thanks for your message. I'm away until…"
            onChange={(e) => setDraft({ ...draft, textBody: e.currentTarget.value })}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Plain text. Everyone who writes to you sees this, including people
            you have never met.
          </p>
        </div>

        {problem && <p className="text-sm text-destructive">{problem.message}</p>}

        {!problem && draft.isEnabled && (
          <p className="text-sm text-muted-foreground">
            {state.state === "scheduled"
              ? `Nothing will send until ${state.from.toLocaleString()}.`
              : state.state === "active" && state.until
                ? `Replying to everyone until ${state.until.toLocaleString()}.`
                : state.state === "active"
                  ? "Replying to everyone, until you turn this off."
                  : null}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-4 py-3">
        <Button onClick={submit} disabled={pending || problem !== null}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
        <Link
          href={closeHref}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}

/**
 * `datetime-local` gives wall-clock time with no zone: "2026-08-18T09:00".
 * `new Date()` reads that in the browser's zone, which is the one the person
 * typing it meant, and toISOString turns it into the absolute instant the mail
 * server compares against.
 */
function toInstant(local: string | null): string {
  if (!local) return "";
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}
