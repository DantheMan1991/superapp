"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Lock, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
}: {
  partyId: string;
  collaborators: CrmRecordCollaborator[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [clerkUserId, setClerkUserId] = useState("");

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
              <span className="truncate font-mono text-xs">
                {collaborator.clerkUserId}
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

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="collab-user" className="text-xs">
            Add someone
          </Label>
          {/*
            A USER ID RATHER THAN A PICKER, and this is the honest limitation.
            CRM has no roster of the tenant's members to choose from — Clerk
            holds it and nothing in this module reads it — so until slice 6's
            follow-up wires that in, the id is typed. A picker is the obvious
            next move and it is recorded as an open item rather than pretended
            away.
          */}
          <Input
            id="collab-user"
            value={clerkUserId}
            placeholder="Clerk user id"
            onChange={(e) => setClerkUserId(e.target.value)}
          />
        </div>
        <Button onClick={grant} disabled={pending || !clerkUserId.trim()}>
          <Plus className="mr-1.5 size-4" /> Add
        </Button>
      </div>
    </section>
  );
}
