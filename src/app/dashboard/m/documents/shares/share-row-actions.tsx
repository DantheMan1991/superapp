"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Activity,
  Copy,
  Loader2,
  MoreHorizontal,
  Send,
  Unlock,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { ShareStatus } from "@/db/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  emailShareAction,
  resetShareLockAction,
  revealShareUrlAction,
  revokeShareAction,
} from "@/modules/documents/share-actions";
import { ShareActivitySheet } from "@/modules/documents/components/share-activity";

export function ShareRowActions({
  shareId,
  version,
  status,
  isOwner,
  hasPasscode,
  label,
  canWrite = true,
}: {
  shareId: string;
  version: number;
  status: ShareStatus;
  isOwner: boolean;
  hasPasscode: boolean;
  /** What this link points at, for the activity sheet's header. */
  label?: string;
  /**
   * `roleMayWrite(role)`. Revoking is a write; WHO USED THE LINK is a read, and
   * it is the reason an accountant is on this page — so the activity sheet
   * stays and the revoke goes.
   */
  canWrite?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [, setBusy] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [activity, setActivity] = useState(false);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");

  const revoked = status === "revoked";

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Link actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Copying decrypts the token server-side and records that it
            happened — the URL is never sitting in this page's HTML. That
            recording is a write, so it goes with the rest for an accountant. */}
        {canWrite && (
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
        )}

        {/* Available even on a revoked link — what happened while it was live
            is exactly what someone asks about after turning it off. */}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setActivity(true);
          }}
        >
          <Activity className="size-4" />
          Activity…
        </DropdownMenuItem>

        {/* A passcode-protected link is never emailable: the link and the
            passcode in one message is one factor, not two. */}
        {canWrite && !revoked && !hasPasscode && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setEmailing(true);
            }}
          >
            <Send className="size-4" />
            Email link…
          </DropdownMenuItem>
        )}

        {canWrite && status === "locked" && isOwner && (
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

        {canWrite && !revoked && (
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

    {/* Mounted only while open: the sheet fetches its feed on mount. */}
    {activity && (
      <ShareActivitySheet
        open
        onOpenChange={setActivity}
        shareId={shareId}
        label={label ?? "this link"}
      />
    )}

    <Dialog open={emailing} onOpenChange={setEmailing}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email this link</DialogTitle>
          <DialogDescription>
            Goes out from your business&apos;s address. Separate multiple
            recipients with commas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`to-${shareId}`}>To</Label>
            <Input
              id={`to-${shareId}`}
              value={to}
              placeholder="sub@example.com, inspector@example.com"
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`msg-${shareId}`}>Message (optional)</Label>
            <Textarea
              id={`msg-${shareId}`}
              value={message}
              maxLength={1000}
              rows={3}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEmailing(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || to.trim().length < 6}
            onClick={() =>
              startTransition(async () => {
                const recipients = to
                  .split(",")
                  .map((value) => value.trim())
                  .filter((value) => value.length > 0);
                const result = await emailShareAction({
                  shareId,
                  to: recipients,
                  message,
                });
                if ("error" in result) {
                  toast.error(result.error);
                  return;
                }
                toast.success(
                  `Sent from ${result.data?.sentFrom ?? "your address"}`,
                );
                setEmailing(false);
                setTo("");
                setMessage("");
                router.refresh();
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
