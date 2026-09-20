"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Copy, Plus, Trophy } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  awardBidAction,
  createBidPackageAction,
  inviteToBidAction,
  revealBidLinkAction,
  revokeBidLinkAction,
  setBidPackageStatusAction,
} from "../bids-actions";

/**
 * Asking subcontractors for a number (X3, ADR 0098).
 *
 * **THE LINK IS COPIED, NOT EMAILED**, and the copy says so. SES production
 * access is still denied, so a "send" button would quietly reach nobody; a
 * builder texts or emails the link themselves, which is how they already
 * talk to their subs. Sending becomes one more way to hand over the same
 * link when the relay is free.
 */

async function copy(text: string, said: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(said);
  } catch {
    toast.error("Could not copy it. Select it by hand.");
  }
}

function linkFor(token: string): string {
  return `${window.location.origin}/bid/${token}`;
}

export function NewBidPackageButton({
  projectId,
  codes,
}: {
  projectId: string;
  codes: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [costCode, setCostCode] = useState("");
  const [scope, setScope] = useState("");
  const [dueOn, setDueOn] = useState("");

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> Ask for prices
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ask for prices</DialogTitle>
            <DialogDescription>
              One scope, and the subcontractors you want a number from. They get
              a link — no sign-in, and they see only what you write here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bid-title">What is being priced</Label>
              <Input
                id="bid-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Electrical"
                maxLength={200}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bid-code">Cost code</Label>
                <Select value={costCode} onValueChange={setCostCode}>
                  <SelectTrigger id="bid-code">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    {codes.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} · {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  A walk uses the winning number on this phase.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bid-due">Wanted by</Label>
                <Input
                  id="bid-due"
                  type="date"
                  value={dueOn}
                  onChange={(e) => setDueOn(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bid-scope">The scope</Label>
              <Textarea
                id="bid-scope"
                rows={6}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                placeholder="What is included, what is not, and anything they need to know to price it. This is all they see."
                maxLength={8000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || title.trim() === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await createBidPackageAction({
                    projectId,
                    title: title.trim(),
                    costCode: costCode || undefined,
                    scope: scope.trim() || undefined,
                    dueOn: dueOn || undefined,
                  });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  setOpen(false);
                  setTitle("");
                  setScope("");
                  setDueOn("");
                  router.refresh();
                })
              }
            >
              {pending ? "Adding…" : "Add it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function InviteButton({
  projectId,
  packageId,
  parties,
}: {
  projectId: string;
  packageId: string;
  parties: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [partyId, setPartyId] = useState("");

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" /> Ask somebody
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ask a subcontractor</DialogTitle>
            <DialogDescription>
              They get their own link, so you can see who has looked and take
              one back without touching the others.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="bid-party">Who</Label>
            <Select value={partyId} onValueChange={setPartyId}>
              <SelectTrigger id="bid-party">
                <SelectValue placeholder="Pick one" />
              </SelectTrigger>
              <SelectContent>
                {parties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || partyId === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await inviteToBidAction({
                    projectId,
                    packageId,
                    partyId,
                  });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  await copy(linkFor(result.token), "Link copied — send it to them");
                  setOpen(false);
                  setPartyId("");
                  router.refresh();
                })
              }
            >
              {pending ? "Asking…" : "Make their link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CopyBidLinkButton({
  projectId,
  invitationId,
}: {
  projectId: string;
  invitationId: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await revealBidLinkAction({ projectId, invitationId });
          if ("error" in result) toast.error(result.error);
          else await copy(linkFor(result.token), "Link copied");
        })
      }
    >
      <Copy className="mr-1.5 size-3.5" /> Copy link
    </Button>
  );
}

export function RevokeBidLinkButton({
  projectId,
  invitationId,
}: {
  projectId: string;
  invitationId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await revokeBidLinkAction({ projectId, invitationId });
          if ("error" in result) toast.error(result.error);
          else {
            toast.success("Their link is closed");
            router.refresh();
          }
        })
      }
    >
      <Ban className="mr-1.5 size-3.5" /> Close their link
    </Button>
  );
}

export function AwardBidButton({
  projectId,
  invitationId,
}: {
  projectId: string;
  invitationId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await awardBidAction({ projectId, invitationId });
          if ("error" in result) toast.error(result.error);
          else {
            toast.success("Going with this one");
            router.refresh();
          }
        })
      }
    >
      <Trophy className="mr-1.5 size-3.5" /> Go with this
    </Button>
  );
}

export function CloseBidPackageButton({
  projectId,
  packageId,
  status,
}: {
  projectId: string;
  packageId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = status === "open" ? "closed" : "open";
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setBidPackageStatusAction({ projectId, packageId, status: next });
          if ("error" in result) toast.error(result.error);
          else router.refresh();
        })
      }
    >
      {status === "open" ? "Stop taking prices" : "Take prices again"}
    </Button>
  );
}
