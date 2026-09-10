"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useOrganizationList } from "@clerk/nextjs";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  createOperatorPartiesAction,
  createOperatorPartyAction,
} from "./actions";

/**
 * Open the workspace's party in the operator's CRM — one click, not two.
 *
 * The CRM route reads the ACTIVE organization, and the console is used from
 * whichever organization the founder happens to be in. So the button makes
 * the operator active first — Clerk's `setActive`, the same call the sidebar
 * switcher makes — and only then navigates. Without that, the record page
 * would 404 inside a client's workspace, which is not where the party is.
 */
export function OpenInCrmButton({
  partyId,
  operatorClerkOrgId,
}: {
  partyId: string;
  operatorClerkOrgId: string | null;
}) {
  const router = useRouter();
  const { isLoaded, setActive } = useOrganizationList();
  const [pending, startTransition] = useTransition();
  const href = `/dashboard/m/crm/records/${partyId}`;

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending || !isLoaded}
      onClick={() =>
        startTransition(async () => {
          try {
            if (operatorClerkOrgId && setActive) {
              await setActive({ organization: operatorClerkOrgId });
            }
          } catch {
            toast.error("Could not switch to the operator's workspace.");
            return;
          }
          router.push(href);
        })
      }
    >
      {pending ? "Opening…" : "Open in CRM"}
    </Button>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One workspace: make its party in the operator's CRM and point at it. */
export function CreatePartyButton({ tenantId }: { tenantId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createOperatorPartyAction({ tenantId });
          if ("error" in res) {
            toast.error(res.error);
            return;
          }
          toast.success(res.created ? "Party created" : "Already linked to its party");
        })
      }
    >
      {pending ? "Creating…" : "Create its party in the CRM"}
    </Button>
  );
}

/** The backfill: every workspace with no party yet, from the Clients page. */
export function CreatePartiesButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createOperatorPartiesAction();
          if ("error" in res) {
            toast.error(res.error);
            return;
          }
          toast.success(`${plural(res.created, "party", "parties")} created`);
        })
      }
    >
      {pending
        ? "Creating…"
        : `Create parties for ${plural(count, "workspace", "workspaces")}`}
    </Button>
  );
}
