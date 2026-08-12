"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Quote, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DraftedRecord } from "@/lib/mail-extensions/types";
import {
  acceptThreadDraftAction,
  draftFromThreadAction,
} from "../thread-draft-actions";

/**
 * "Draft an invoice from this conversation", and the review that follows.
 *
 * THE CITATIONS ARE THE FEATURE, and this is the only screen where they can be
 * checked — the reader has the original email open behind this dialog, so each
 * proposed figure sits next to the sentence it came from and the two can be
 * compared in a second. Carrying the lines off to the invoice builder would
 * leave the evidence behind, which is the thing this exists to avoid.
 *
 * A line whose quote could NOT be found in the message it cites arrives
 * unticked and marked. It is not hidden: silently dropping a figure somebody
 * may be owed is its own kind of wrong, and the reader is looking at the
 * conversation anyway.
 */

const money = (cents: number) =>
  `${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ThreadDraftButton({
  mailboxId,
  threadId,
  extensionSlug,
  kind,
  label,
}: {
  mailboxId: string;
  threadId: string;
  extensionSlug: string;
  kind: string;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<DraftedRecord | null>(null);
  const [included, setIncluded] = useState<boolean[]>([]);
  const [partyName, setPartyName] = useState("");
  const [pending, startTransition] = useTransition();
  const [saving, startSaving] = useTransition();

  function run() {
    setOpen(true);
    setRecord(null);
    startTransition(async () => {
      const result = await draftFromThreadAction({
        mailboxId,
        threadId,
        extensionSlug,
        kind,
      });
      if ("error" in result) {
        toast.error(result.error);
        setOpen(false);
        return;
      }
      const drafted = result.data!;
      setRecord(drafted);
      setPartyName(drafted.partyName);
      // Unverified lines start unticked — they cannot be accepted by
      // inattention, only by someone deciding they are right.
      setIncluded(drafted.lines.map((l) => l.citation?.verified === true));
    });
  }

  function accept() {
    if (!record) return;
    const lines = record.lines.filter((_, i) => included[i]);
    if (lines.length === 0) {
      toast.error("Tick at least one line first");
      return;
    }
    startSaving(async () => {
      const result = await acceptThreadDraftAction({
        extensionSlug,
        record: { ...record, lines },
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const { entityType, entityId } = result.data!;
      toast.success(`Draft ${entityType} created`, {
        description: "Nothing has been posted — open it to review and issue.",
      });
      setOpen(false);
      router.push(hrefFor(entityType, entityId));
    });
  }

  const anyUnverified = record?.lines.some((l) => !l.citation?.verified) ?? false;

  return (
    <>
      <Button variant="outline" size="sm" onClick={run} disabled={pending}>
        <Sparkles className="mr-1.5 size-3.5" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              Read from this conversation. Nothing is created until you press
              the button, and nothing is posted even then — it becomes a draft.
            </DialogDescription>
          </DialogHeader>

          {pending && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Reading the conversation…
            </p>
          )}

          {record && !pending && (
            <div className="space-y-4">
              {record.caveats.length > 0 && (
                <ul className="space-y-1 rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
                  {record.caveats.map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="draft-party">
                    {record.kind === "bill" ? "Supplier" : "Customer"}
                  </Label>
                  <Input
                    id="draft-party"
                    value={partyName}
                    onChange={(e) => setPartyName(e.target.value)}
                    disabled
                  />
                  {!record.partyId && (
                    <p className="text-xs text-warning-foreground">
                      Not matched to anyone on file — add them first, then draft
                      again.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Dates</Label>
                  <p className="font-mono text-sm tabular-nums">
                    {record.issueDate}
                    {record.dueDate ? ` → ${record.dueDate}` : " · no due date"}
                  </p>
                </div>
              </div>

              {record.lines.length === 0 ? (
                <p className="rounded-xl bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">
                  Nothing in this conversation looked like an agreed amount.
                </p>
              ) : (
                <ul className="space-y-2">
                  {record.lines.map((line, i) => {
                    const verified = line.citation?.verified === true;
                    return (
                      <li
                        key={i}
                        className="rounded-xl bg-card p-3 shadow-elevation-1"
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 size-4"
                            checked={included[i] ?? false}
                            onChange={(e) => {
                              const next = [...included];
                              next[i] = e.target.checked;
                              setIncluded(next);
                            }}
                            aria-label={`Include ${line.description}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <p className="text-sm font-medium">
                                {line.description}
                              </p>
                              <p className="shrink-0 font-mono text-sm tabular-nums">
                                {line.quantity} × {money(line.unitPriceCents)}
                              </p>
                            </div>

                            {line.citation ? (
                              <blockquote
                                className={
                                  verified
                                    ? "mt-2 border-l-2 border-module-accent/40 pl-3 text-xs text-muted-foreground"
                                    : "mt-2 border-l-2 border-warning pl-3 text-xs text-warning-foreground"
                                }
                              >
                                <Quote className="mr-1 inline size-3" />
                                {line.citation.quote}
                                <span className="ml-2 text-subtle-foreground">
                                  — message {line.citation.messageIndex + 1}
                                </span>
                                {!verified && (
                                  <Badge variant="outline" className="ml-2">
                                    not found in that message
                                  </Badge>
                                )}
                              </blockquote>
                            ) : (
                              <p className="mt-2 text-xs text-warning-foreground">
                                No source quoted — check this one yourself.
                              </p>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            {anyUnverified && (
              <p className="text-xs text-muted-foreground">
                Unticked lines could not be matched to the conversation.
              </p>
            )}
            <Button
              onClick={accept}
              disabled={saving || pending || !record || !record.partyId}
            >
              {saving ? "Creating…" : `Create draft ${record?.kind ?? ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Where a newly drafted record lives. */
function hrefFor(entityType: string, entityId: string): string {
  return entityType === "bill"
    ? `/dashboard/m/accounting/purchases/bills/${entityId}`
    : `/dashboard/m/accounting/sales/invoices/${entityId}`;
}

/** Renders nothing when no module contributes a drafter. */
export function ThreadDraftBar({
  mailboxId,
  threadId,
  drafters,
}: {
  mailboxId: string;
  threadId: string;
  drafters: Array<{ extensionSlug: string; kind: string; label: string }>;
}) {
  if (drafters.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {drafters.map((d) => (
        <ThreadDraftButton
          key={`${d.extensionSlug}:${d.kind}`}
          mailboxId={mailboxId}
          threadId={threadId}
          extensionSlug={d.extensionSlug}
          kind={d.kind}
          label={d.label}
        />
      ))}
    </div>
  );
}
