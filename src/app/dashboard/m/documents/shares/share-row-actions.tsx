"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Loader2, MoreHorizontal, Send, Unlock, XCircle } from "lucide-react";
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

export function ShareRowActions({
  shareId,
  version,
  status,
  isOwner,
  hasPasscode,
}: {
  shareId: string;
  version: number;
  status: ShareStatus;
  isOwner: boolean;
  hasPasscode: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [, setBusy] = useState(false);
  const [emailing, setEmailing] = useState(false);
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

        {/* A passcode-protected link is never emailable: the link and the
            passcode in one message is one factor, not two. */}
        {!revoked && !hasPasscode && (
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
