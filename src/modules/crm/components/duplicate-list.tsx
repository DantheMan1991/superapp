"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
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
import type { MergeCandidate, MergeEvidence, MergePlan } from "../core/merge";
import { touchesLedger } from "../core/merge";
import { mergeRecordsAction, previewMergeAction } from "../merge-actions";

/**
 * The duplicates list, and the merge confirmation.
 *
 * WHAT THIS SCREEN IS FOR: making somebody's choice informed, not making it for
 * them. The evidence is spelled out in words ("both have accounts@probe.example")
 * rather than shown as a match percentage, because a percentage invites people
 * to trust the number instead of looking at the two records — and the one thing
 * a merge cannot survive is being committed by somebody who did not look.
 *
 * THE PREVIEW IS THE PLAN THE EXECUTOR RUNS. It is fetched from the server
 * rather than guessed at here, and the server recomputes it inside the
 * committing transaction, so what this dialog lists is what happens.
 */

interface PartyInfo {
  name: string;
  kind: "person" | "organization";
}

export function DuplicateList({
  candidates,
  names,
}: {
  candidates: MergeCandidate[];
  names: Record<string, PartyInfo>;
}) {
  const [pair, setPair] = useState<MergeCandidate | null>(null);

  if (candidates.length === 0) {
    return (
      <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
        No likely duplicates. Records are compared on shared email addresses and
        phone numbers, and on identical names.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y rounded-md border">
        {candidates.map((candidate) => {
          const a = names[candidate.aPartyId];
          const b = names[candidate.bPartyId];
          if (!a || !b) return null;
          return (
            <li
              key={`${candidate.aPartyId}:${candidate.bPartyId}`}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium">
                  {a.name} <span className="text-muted-foreground">and</span>{" "}
                  {b.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {candidate.evidence.map(describeEvidence).join(" · ")}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => setPair(candidate)}
              >
                Review
              </Button>
            </li>
          );
        })}
      </ul>

      {pair && (
        <MergeDialog
          candidate={pair}
          names={names}
          onClose={() => setPair(null)}
        />
      )}
    </>
  );
}

/** Words, not a score. See the header. */
function describeEvidence(evidence: MergeEvidence): string {
  switch (evidence.kind) {
    case "shared_email":
      return `both use ${evidence.value}`;
    case "shared_phone":
      return `both use ${evidence.value}`;
    case "same_name":
      return "same name";
  }
}

function MergeDialog({
  candidate,
  names,
  onClose,
}: {
  candidate: MergeCandidate;
  names: Record<string, PartyInfo>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [survivorPartyId, setSurvivorPartyId] = useState(candidate.aPartyId);
  /**
   * The fetched plan, TAGGED WITH THE CHOICE IT DESCRIBES.
   *
   * Derived rather than reset, so flipping the survivor cannot leave the
   * previous plan on screen for a frame — the tag stops matching and `plan`
   * becomes null in the same render as the click. Resetting it in the effect
   * instead would be a synchronous setState in an effect body, which is the
   * cascading-render pattern the lint rule refuses.
   */
  const [fetched, setFetched] = useState<{
    survivorPartyId: string;
    plan: MergePlan | null;
  } | null>(null);

  const loserPartyId =
    survivorPartyId === candidate.aPartyId
      ? candidate.bPartyId
      : candidate.aPartyId;

  const current = fetched?.survivorPartyId === survivorPartyId ? fetched : null;
  const plan = current?.plan ?? null;
  const loading = current === null;

  // Re-fetched whenever the survivor changes, because the plan is NOT
  // symmetrical — which record keeps its lifecycle stage, and which role row
  // absorbs the other's invoices, both depend on the choice. `stale` guards the
  // case somebody flips the choice twice quickly: the first request must not
  // land after the second and describe a merge that is no longer selected.
  useEffect(() => {
    let stale = false;
    void previewMergeAction({ survivorPartyId, loserPartyId }).then((result) => {
      if (stale) return;
      if ("error" in result) {
        toast.error(result.error);
        // Tagged all the same, so the spinner stops and the Merge button stays
        // disabled — a failed preview must not look like a merge with nothing
        // to move.
        setFetched({ survivorPartyId, plan: null });
      } else {
        setFetched({ survivorPartyId, plan: result.data!.plan });
      }
    });
    return () => {
      stale = true;
    };
  }, [survivorPartyId, loserPartyId]);

  function commit(): void {
    startTransition(async () => {
      const result = await mergeRecordsAction({ survivorPartyId, loserPartyId });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Records merged");
        onClose();
        router.refresh();
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge these records</DialogTitle>
          <DialogDescription>
            One record is kept and the other is removed. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Which one do you keep?</p>
            {[candidate.aPartyId, candidate.bPartyId].map((partyId) => (
              <button
                key={partyId}
                type="button"
                onClick={() => setSurvivorPartyId(partyId)}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
                  survivorPartyId === partyId ? "border-foreground" : ""
                }`}
              >
                <span className="truncate">{names[partyId]?.name}</span>
                {survivorPartyId === partyId && <Badge>keep</Badge>}
              </button>
            ))}
          </div>

          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Working out what moves…
            </p>
          )}

          {plan && <PlanSummary plan={plan} names={names} loser={loserPartyId} />}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={commit} disabled={pending || !plan}>
            {pending ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanSummary({
  plan,
  names,
  loser,
}: {
  plan: MergePlan;
  names: Record<string, PartyInfo>;
  loser: string;
}) {
  const moving: string[] = [];
  const m = plan.moves;
  if (m.deals) moving.push(count(m.deals, "deal"));
  if (m.activities) moving.push(count(m.activities, "timeline entry"));
  if (m.tasks) moving.push(count(m.tasks, "follow-up"));
  if (m.dealStakeholders) moving.push(count(m.dealStakeholders, "deal contact"));
  if (plan.contactPoints.move.length) {
    moving.push(count(plan.contactPoints.move.length, "contact detail"));
  }
  if (plan.affiliations.move.length) {
    moving.push(count(plan.affiliations.move.length, "connection"));
  }
  if (plan.collaborators.move.length) {
    // Named rather than folded into "details": who can see a confidential
    // record is the thing somebody would most want to be told is changing.
    moving.push(
      count(
        plan.collaborators.move.length,
        "person with access",
        "people with access",
      ),
    );
  }

  const dropped =
    plan.contactPoints.dropDuplicate.length +
    plan.affiliations.dropSelf.length +
    plan.affiliations.dropDuplicate.length;

  return (
    <div className="space-y-3 rounded-md border p-3 text-sm">
      <p className="flex items-center gap-2 text-muted-foreground">
        <span className="truncate">{names[loser]?.name}</span>
        <ArrowRight className="size-4 shrink-0" />
        <span className="truncate font-medium text-foreground">
          {names[plan.survivorPartyId]?.name}
        </span>
      </p>

      {/*
        THE LEDGER WARNING GETS ITS OWN LINE, not a row in a table of counts.
        Re-pointing a posted invoice is the one thing a merge does that reaches
        outside CRM, and somebody committing it should be told in a sentence.
      */}
      {touchesLedger(plan) && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>
            {[
              m.invoices ? count(m.invoices, "invoice") : null,
              m.recurringEntries
                ? count(m.recurringEntries, "recurring entry")
                : null,
              m.bills ? count(m.bills, "bill") : null,
            ]
              .filter(Boolean)
              .join(", ")}{" "}
            will be moved onto the customer or supplier record you are keeping.
            Totals and the ledger are unchanged.
          </span>
        </p>
      )}

      <p className="text-muted-foreground">
        {moving.length > 0
          ? `Moving ${moving.join(", ")}.`
          : "Nothing else to move."}
      </p>

      {plan.details.deleteLoserDetails && (
        <p className="text-muted-foreground">
          Notes from both records are kept, one after the other.
        </p>
      )}

      {dropped > 0 && (
        <p className="text-muted-foreground">
          {count(dropped, "duplicate detail")} already on the record you are
          keeping will not be copied again.
        </p>
      )}
    </div>
  );
}

/**
 * `2 deals`, `1 invoice`, `2 people with access`.
 *
 * The explicit plural exists because appending "s" is wrong the moment a noun
 * is a phrase — "2 person with accesss" — and every count on this screen is
 * read by somebody deciding whether to commit something irreversible.
 */
function count(n: number, noun: string, plural?: string): string {
  return `${n} ${n === 1 ? noun : (plural ?? `${noun}s`)}`;
}
