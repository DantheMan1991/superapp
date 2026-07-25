"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, MoreHorizontal, Unlock, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { ShareStatus } from "@/db/schema";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  resetShareLockAction,
  revealShareUrlAction,
  revokeShareAction,
} from "@/modules/documents/share-actions";

export function ShareRowActions({
  shareId,
  version,
  status,
  isOwner,
}: {
  shareId: string;
  version: number;
  status: ShareStatus;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [, setBusy] = useState(false);

  const revoked = status === "revoked";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Link actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Copying decrypts the token server-side and records that it
            happened — the URL is never sitting in this page's HTML. */}
        <DropdownMenuItem
          disabled={pending || revoked}
          onSelect={() => {
            setBusy(true);
            startTransition(async () => {
              const result = await revealShareUrlAction({ shareId });
              setBusy(false);
              if ("error" in result) {
                toast.error(result.error);
                return;
              }
              await navigator.clipboard.writeText(result.data?.url ?? "");
              toast.success("Link copied");
            });
          }}
        >
          <Copy className="size-4" />
          Copy link
        </DropdownMenuItem>

        {status === "locked" && isOwner && (
          <DropdownMenuItem
            disabled={pending}
            onSelect={() =>
              startTransition(async () => {
                const result = await resetShareLockAction({ shareId });
                if ("error" in result) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Passcode attempts reset");
                router.refresh();
              })
            }
          >
            <Unlock className="size-4" />
            Reset passcode attempts
          </DropdownMenuItem>
        )}

        {!revoked && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={pending}
              onSelect={() =>
                startTransition(async () => {
                  const result = await revokeShareAction({
                    shareId,
                    expectedVersion: version,
                  });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("Link turned off");
                  router.refresh();
                })
              }
            >
              <XCircle className="size-4" />
              Turn off link
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
