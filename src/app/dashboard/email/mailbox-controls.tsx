"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { Mailbox, PreviousMxRecord } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  checkHostedDomainAction,
  createMailboxAction,
  cutoverHostedDomainAction,
  deleteMailboxAction,
  disconnectHostedDomainAction,
  setupHostedDomainAction,
} from "./mailbox-actions";

/** A callout that has to be read, not skimmed past. */
function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function SetupHostedDomainForm() {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await setupHostedDomainAction({ domain });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          if (result.data?.rollbackUnavailable) {
            // Say it out loud rather than showing a rollback card that would
            // restore the state it is already in.
            toast.warning(
              "This domain's mail already pointed here, so there is no earlier setup to roll back to.",
            );
          }
          toast.success(
            result.data?.adopted
              ? "Found this domain already at the mail host and picked it up."
              : result.data?.alreadyHasMail
                ? `Added. Your mail currently goes to ${result.data.currentMail} — nothing has changed yet.`
                : "Added — nothing has changed yet.",
          );
          router.refresh();
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="hosted-domain">Your company domain</Label>
        <Input
          id="hosted-domain"
          value={domain}
          maxLength={253}
          placeholder="yourcompany.com"
          onChange={(e) => setDomain(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Use your main domain — the one your address already ends in. Adding it
        here changes nothing on its own: you will see exactly what to do next,
        and mail keeps arriving wherever it arrives today until you decide
        otherwise.
      </p>
      <Button type="submit" disabled={pending || domain.trim().length < 4}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Add domain
      </Button>
    </form>
  );
}

export function CheckDnsButton({ status }: { status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await checkHostedDomainAction();
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          if (result.data?.status === "dns_ready") {
            toast.success("DNS looks right — you can switch over when ready");
          } else if (result.data?.status === "active") {
            toast.success("Everything checks out");
          } else {
            toast.info(
              result.data?.findings?.[0] ??
                "Not there yet. DNS changes can take up to an hour to spread.",
            );
          }
          router.refresh();
        })
      }
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <RefreshCw className="size-4" />
      )}
      {status === "active" ? "Re-check" : "Check DNS"}
    </Button>
  );
}

/**
 * The cutover gate.
 *
 * Typing the domain is the friction, and it is here because this is the one
 * action in the product that cannot be undone from inside the product. Undoing
 * it means editing DNS at a registrar and waiting for the internet to catch up,
 * during which the business's mail is going to the wrong place.
 */
export function CutoverPanel({
  domain,
  previousProvider,
  mailboxCount,
}: {
  domain: string;
  previousProvider: string;
  mailboxCount: number;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const matches = confirm.trim().toLowerCase() === domain.toLowerCase();

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-medium">Switch mail over to Yosher</h4>
        <p className="text-sm text-muted-foreground">
          Your DNS records check out. This last step tells the mail host to
          start accepting mail for {domain}.
        </p>
      </div>

      {mailboxCount === 0 && (
        <Warning>
          <p className="font-medium">Create your mailboxes first.</p>
          <p>
            No mailboxes exist yet. If mail starts arriving for an address that
            has not been created, it does not wait — it bounces back to whoever
            sent it, and they are told the address does not exist. Add everyone
            below, then come back here.
          </p>
        </Warning>
      )}

      <Warning>
        <p className="font-medium">
          This redirects every email sent to {domain}.
        </p>
        <p>
          Mail currently goes to {previousProvider}. After this, it arrives
          here instead. Anything still sitting in the old system stays there —
          this moves future mail, not past mail.
        </p>
      </Warning>

      <div className="space-y-2">
        <Label htmlFor="cutover-confirm">
          Type <span className="font-mono">{domain}</span> to confirm
        </Label>
        <Input
          id="cutover-confirm"
          value={confirm}
          maxLength={253}
          autoComplete="off"
          placeholder={domain}
          onChange={(e) => setConfirm(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <Button
        disabled={pending || !matches}
        onClick={() =>
          startTransition(async () => {
            const result = await cutoverHostedDomainAction({
              confirmDomain: confirm,
            });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success(`${domain} mail now arrives in Yosher`);
            setConfirm("");
            router.refresh();
          })
        }
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        Switch mail over
      </Button>
    </div>
  );
}

/**
 * What to put back if this goes wrong. Rendered as plain, copyable values
 * rather than a button, because restoring MX happens at the registrar and we
 * have no business reaching into that.
 */
export function RollbackCard({
  records,
  previousProvider,
}: {
  records: PreviousMxRecord[];
  previousProvider: string;
}) {
  if (records.length === 0) {
    return (
      <div className="rounded-md border p-4 text-sm text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <Undo2 className="size-4" />
          Undoing this
        </p>
        <p className="mt-1">
          This domain had no mail records when it was set up, so there is
          nothing to restore — removing the MX records below at your DNS
          provider puts it back as it was.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div>
        <p className="flex items-center gap-2 text-sm font-medium">
          <Undo2 className="size-4" />
          Undoing this
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Mail used to go to {previousProvider}. To send it back, replace the MX
          records at your DNS provider with exactly these. Keep this list —
          it is the only copy.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Priority</TableHead>
              <TableHead>Mail server</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow key={`${record.priority}-${record.host}`}>
                <TableCell className="font-mono text-xs">
                  {record.priority}
                </TableCell>
                <TableCell className="font-mono text-xs break-all">
                  {record.host}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function CreateMailboxForm({ domain }: { domain: string }) {
  const router = useRouter();
  const [localPart, setLocalPart] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await createMailboxAction({
            localPart,
            displayName,
            inviteEmail,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(
            `${result.data?.address} created — setup link sent to ${result.data?.invitedTo}`,
          );
          setLocalPart("");
          setDisplayName("");
          setInviteEmail("");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="mailbox-local">Address</Label>
          <div className="flex items-center gap-1">
            <Input
              id="mailbox-local"
              value={localPart}
              maxLength={63}
              placeholder="dan"
              onChange={(e) => setLocalPart(e.target.value)}
            />
            <span className="shrink-0 text-sm text-muted-foreground">
              @{domain}
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="mailbox-name">Name</Label>
          <Input
            id="mailbox-name"
            value={displayName}
            maxLength={120}
            placeholder="Dan Rhouser"
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mailbox-invite">Send setup link to</Label>
          <Input
            id="mailbox-invite"
            type="email"
            value={inviteEmail}
            maxLength={254}
            placeholder="their personal address"
            onChange={(e) => setInviteEmail(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        They choose their own password from that link — it never passes through
        Yosher, so nobody here can read their mail. Send it to an address they
        can already open, not one at @{domain}.
      </p>
      <Button
        type="submit"
        disabled={pending || localPart.trim().length < 1 || inviteEmail.length < 6}
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        Create mailbox
      </Button>
    </form>
  );
}

export function MailboxRowActions({ mailbox }: { mailbox: Mailbox }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const matches = confirm.trim().toLowerCase() === mailbox.address.toLowerCase();

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${mailbox.address}`}
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-4" />
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Input
        value={confirm}
        maxLength={254}
        autoComplete="off"
        placeholder={`Type ${mailbox.address}`}
        onChange={(e) => setConfirm(e.target.value)}
        className="h-8 w-56"
      />
      <Button
        variant="destructive"
        size="sm"
        disabled={pending || !matches}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteMailboxAction({
              mailboxId: mailbox.id,
              confirmAddress: confirm,
            });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success(`${result.data?.address} deleted`);
            router.refresh();
          })
        }
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        Delete for good
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setConfirming(false);
          setConfirm("");
        }}
      >
        Cancel
      </Button>
    </div>
  );
}

export function DisconnectHostedDomainButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await disconnectHostedDomainAction();
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(
            "Removed from Yosher. The mailboxes still exist at the mail host.",
          );
          router.refresh();
        })
      }
    >
      Stop managing this domain
    </Button>
  );
}
