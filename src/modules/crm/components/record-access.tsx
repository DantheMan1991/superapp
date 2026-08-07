"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Lock, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CrmRecordCollaborator } from "@/db/schema";
import {
  grantRecordAccessAction,
  revokeRecordAccessAction,
} from "../collaborator-actions";

/**
 * Who can see a restricted record.
 *
 * SHOWN ONLY WHEN IT MEANS SOMETHING — on a restricted record, to an owner. On
 * a `members` record everybody can already see everything, so a list of people
 * with special access would be a control that does nothing, and the first
 * question it raises ("so who CAN'T see this?") has no answer worth giving.
 *
 * The panel says what `restricted` costs and what a grant buys in one line
 * each, because the two are easy to conflate: restricting hides what CRM knows,
 * not that the business deals with somebody, and a grant hands one person the
 * whole of it rather than a part.
 */
export function RecordAccess({
  partyId,
  collaborators,
  members = [],
}: {
  partyId: string;
  collaborators: CrmRecordCollaborator[];
  /**
   * The tenant's whole assignable roster, resolved on the server from the
   * caller's own transaction — so this cannot name somebody the viewer could
   * not already find.
   *
   * The WHOLE roster, not a pre-filtered candidate list, because it does two
   * jobs: naming the people already listed, and offering the ones who could be
   * added. Filtering before it arrives would leave existing collaborators
   * unnamed, which is the version of this I wrote first.
   */
  members?: Array<{
    clerkUserId: string;
    label: string;
    role: "owner" | "staff";
  }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [clerkUserId, setClerkUserId] = useState("");

  /** clerkUserId → the name to show. Falls back to the id, see below. */
  const nameOf = new Map(members.map((m) => [m.clerkUserId, m.label]));

  const granted = new Set(collaborators.map((c) => c.clerkUserId));
  const candidates = members.filter(
    // Owners can already see every restricted record, so a grant to one is a
    // control that does nothing. Anybody already granted is not a candidate.
    (m) => m.role !== "owner" && !granted.has(m.clerkUserId),
  );

  function grant() {
    const trimmed = clerkUserId.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await grantRecordAccessAction({ partyId, clerkUserId: trimmed });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Access granted");
        setClerkUserId("");
        router.refresh();
      }
    });
  }

  function revoke(collaborator: CrmRecordCollaborator) {
    startTransition(async () => {
      const result = await revokeRecordAccessAction({
        partyId,
        collaboratorId: collaborator.id,
        clerkUserId: collaborator.clerkUserId,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Access removed");
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Lock className="size-3.5" /> Who can see this
        </h2>
        <p className="text-xs text-muted-foreground">
          This record is restricted, so owners can see it and nobody else can.
          Anyone added here gets the whole record — its notes, deals, timeline
          and follow-ups.
        </p>
      </div>

      {collaborators.length > 0 && (
        <ul className="divide-y rounded-md border">
          {collaborators.map((collaborator) => (
            <li
              key={collaborator.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              {/*
                A name when we have one, the raw id when we do not — which
                happens for somebody who has since left the organization. Their
                grant is still real and still needs removing, so the row must
                render rather than disappear because the roster no longer
                mentions them.
              */}
              <span
                className={
                  nameOf.has(collaborator.clerkUserId)
                    ? "truncate text-sm"
                    : "truncate font-mono text-xs text-muted-foreground"
                }
              >
                {nameOf.get(collaborator.clerkUserId) ?? collaborator.clerkUserId}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                disabled={pending}
                onClick={() => revoke(collaborator)}
              >
                <X className="size-4" />
                <span className="sr-only">
                  Remove {collaborator.clerkUserId}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/*
        A PICKER AT LAST. This was a typed Clerk user id for one stated reason —
        "CRM has no roster of the tenant's members to choose from" — and that
        stopped being true when `listAssignableMembers` landed for the follow-up
        assignee. Owners are absent from `candidates` deliberately: they can
        already see every restricted record, so granting one access is a control
        that does nothing.
      */}
      {candidates.length > 0 ? (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="collab-user" className="text-xs">
              Add someone
            </Label>
            <Select value={clerkUserId} onValueChange={setClerkUserId}>
              <SelectTrigger id="collab-user" className="w-full">
                <SelectValue placeholder="Choose a colleague" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.clerkUserId} value={c.clerkUserId}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={grant} disabled={pending || !clerkUserId.trim()}>
            <Plus className="mr-1.5 size-4" /> Add
          </Button>
        </div>
      ) : (
        // Everybody who could be added already has been, or the only other
        // members are owners who never needed a grant. Saying so beats an
        // empty dropdown that looks broken.
        <p className="text-xs text-muted-foreground">
          {collaborators.length > 0
            ? "Everyone who can be added already has access."
            : "Nobody else to add — owners can already see this record."}
        </p>
      )}
    </section>
  );
}
