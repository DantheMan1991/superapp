"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { attachAuditToPartyAction, deleteAuditAction } from "./actions";

export interface PartyOption {
  id: string;
  name: string;
}

/** Attach a record to the party it is about — the operator's organizations. */
export function AttachAuditForm({
  auditId,
  parties,
}: {
  auditId: string;
  parties: PartyOption[];
}) {
  const [partyId, setPartyId] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={partyId} onValueChange={setPartyId}>
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Attach to a business in the CRM…" />
        </SelectTrigger>
        <SelectContent>
          {parties.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || !partyId}
        onClick={() =>
          startTransition(async () => {
            const res = await attachAuditToPartyAction({ auditId, partyId });
            if (res?.error) toast.error(res.error);
            else toast.success("Attached");
          })
        }
      >
        {pending ? "Attaching…" : "Attach"}
      </Button>
    </div>
  );
}

/** Delete a record — a test transcript, a duplicate. Asks first. */
export function DeleteAuditButton({ auditId }: { auditId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Delete this discovery record? The conversation and report go with it.")) return;
        startTransition(async () => {
          const res = await deleteAuditAction({ auditId });
          if (res?.error) {
            toast.error(res.error);
            return;
          }
          toast.success("Deleted");
          router.push("/admin/audits");
        });
      }}
    >
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
