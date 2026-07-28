"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plug, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { disconnectMailboxAction } from "../actions";

/**
 * Connecting is a link, not a button that posts.
 *
 * The OAuth start route answers with a redirect to the mail server, and a
 * browser navigation follows that naturally where a fetch from a form action
 * does not. Same reasoning that made the route a route in the first place.
 */
export function ConnectMailboxButton({
  mailboxId,
  reconnect = false,
}: {
  mailboxId: string;
  reconnect?: boolean;
}) {
  return (
    <Button asChild size="sm" variant={reconnect ? "default" : "outline"}>
      <a href={`/api/email/oauth/start?mailboxId=${encodeURIComponent(mailboxId)}`}>
        <Plug className="size-4" />
        {reconnect ? "Reconnect" : "Connect"}
      </a>
    </Button>
  );
}

export function DisconnectMailboxButton({
  mailboxId,
  address,
}: {
  mailboxId: string;
  address: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function disconnect() {
    startTransition(async () => {
      const result = await disconnectMailboxAction({ mailboxId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Mailbox disconnected");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`Disconnect ${address}`}
      >
        <Unplug className="size-4" />
        Disconnect
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect this mailbox?</DialogTitle>
            <DialogDescription>
              Yosher stops reading {address}. Nothing is deleted — the mailbox
              keeps receiving mail, and you can still open it on your phone or
              in Outlook. Connect it again whenever you like.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={disconnect}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
