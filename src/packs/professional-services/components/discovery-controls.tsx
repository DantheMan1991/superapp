"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  attachDiscoveryAction,
  createDiscoveryAction,
  deleteDiscoveryAction,
} from "../discovery-actions";

/** Start a discovery for a business the workspace already knows. */
export function NewDiscoveryButton({
  clients,
  clientWord,
}: {
  clients: { id: string; name: string }[];
  clientWord: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [partyId, setPartyId] = useState(clients[0]?.id ?? "");
  const [pending, startTransition] = useTransition();

  // A discovery is ABOUT a business, and the business is a party. With none
  // in the CRM there is nothing to start one for — say so rather than
  // offering a picker with nothing in it.
  if (clients.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add a {clientWord.toLowerCase()} to your CRM first — a discovery is about one of
        them.
      </p>
    );
  }

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createDiscoveryAction({
        partyId,
        context: String(formData.get("context") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Discovery started");
      setOpen(false);
      router.push(`/dashboard/m/professional-services/discovery/${result.discoveryId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New discovery</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Start a discovery</DialogTitle>
            <DialogDescription>
              Who it is about, and anything you already know going in.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="party">{clientWord}</Label>
              <Select value={partyId} onValueChange={setPartyId}>
                <SelectTrigger id="party">
                  <SelectValue placeholder={`Pick a ${clientWord.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="context">What you know going in</Label>
              <Textarea
                id="context"
                name="context"
                rows={4}
                maxLength={10000}
                placeholder="How you met, who referred them, what they said the problem was. The copilot starts from this."
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !partyId}>
              {pending ? "Starting…" : "Start discovery"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Point a record at the business it is about.
 *
 * For one that arrived from the public health check before that business had
 * a record of its own, and for one whose party was merged away in the CRM.
 */
export function AttachDiscoveryButton({
  discoveryId,
  clients,
  clientWord,
}: {
  discoveryId: string;
  clients: { id: string; name: string }[];
  clientWord: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [partyId, setPartyId] = useState(clients[0]?.id ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Attach to a {clientWord.toLowerCase()}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Which business is this about?</DialogTitle>
          <DialogDescription>
            The conversation stays exactly as it is; it just gains a home.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-4">
          <Select value={partyId} onValueChange={setPartyId}>
            <SelectTrigger>
              <SelectValue placeholder={`Pick a ${clientWord.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !partyId}
            onClick={() =>
              startTransition(async () => {
                const result = await attachDiscoveryAction({ discoveryId, partyId });
                if ("error" in result) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Attached");
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending ? "Attaching…" : "Attach"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Delete a record — a test transcript, a duplicate. Owners only. */
export function DeleteDiscoveryButton({
  discoveryId,
  businessName,
}: {
  discoveryId: string;
  businessName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this discovery?</DialogTitle>
          <DialogDescription>
            The whole conversation with the copilot and the report go with it. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <p className="py-2 text-sm">
          <strong>{businessName}</strong>
        </p>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteDiscoveryAction({ discoveryId });
                if ("error" in result) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Deleted");
                setOpen(false);
                router.push("/dashboard/m/professional-services/discovery");
              })
            }
          >
            {pending ? "Deleting…" : "Delete it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
