import { CheckCircle2, Clock, Inbox, Mail, XCircle } from "lucide-react";
import { requireTenantOwner } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EmailDnsRecord, PreviousMxRecord } from "@/db/schema";
import { loadSendingDomain } from "@/lib/email/domains";
import { listOutboundEmails } from "@/lib/email/send";
import { resolveSender } from "@/lib/email/identity";
import {
  listTenantMailboxes,
  loadHostedDomain,
  rollbackPlan,
} from "@/lib/email/mailbox/provisioning";
import { describeMxProvider } from "@/lib/email/mailbox/mx";
import {
  ConnectDomainForm,
  DnsRecords,
  DomainActions,
  SendTestForm,
} from "./email-controls";
import {
  CheckDnsButton,
  CreateMailboxForm,
  CutoverPanel,
  DisconnectHostedDomainButton,
  MailboxRowActions,
  RollbackCard,
  SetupHostedDomainForm,
} from "./mailbox-controls";

export const dynamic = "force-dynamic";

/**
 * Owner-only. This page decides what address the business's outbound mail
 * claims to come from — invoices, share links, signature requests — so it is
 * not a staff setting.
 */
export default async function EmailSettingsPage() {
  const ctx = await requireTenantOwner();
  const [domain, sent, hosted, mailboxes, rollback] = await Promise.all([
    loadSendingDomain(ctx.tenant.id),
    listOutboundEmails(ctx.tenant.id),
    loadHostedDomain(ctx.tenant.id),
    listTenantMailboxes(ctx.tenant.id),
    rollbackPlan(ctx.tenant.id),
  ]);

  const verified = domain?.status === "verified";
  const sender = resolveSender({
    tenantName: ctx.tenant.name,
    verifiedDomain:
      domain && verified
        ? {
            domain: domain.domain,
            fromLocalPart: domain.fromLocalPart,
            fromName: domain.fromName,
          }
        : null,
    platformDomain: process.env.EMAIL_FROM_DOMAIN ?? "not-configured",
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-brand/15 text-brand-foreground">
          <Mail className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email</h1>
          <p className="text-sm text-muted-foreground">
            What your customers see when the system emails them on your behalf.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sending as</CardTitle>
          <CardDescription>
            Every invoice, share link and notification goes out with this
            address.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="font-mono text-sm">{sender.from}</p>
          {verified ? (
            <Badge className="gap-1">
              <CheckCircle2 className="size-3" />
              Your own domain
            </Badge>
          ) : (
            <p className="text-sm text-muted-foreground">
              Connect your domain below and mail will come from your address
              instead. Until then it sends from ours with your name on it, and
              replies still come back to you.
            </p>
          )}
          <SendTestForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your domain</CardTitle>
          <CardDescription>
            Adding these DNS records proves you own the domain. Without them,
            mail claiming to be from you would be rejected as forged — which is
            exactly what that check is for.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {domain === null ? (
            <ConnectDomainForm />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm">{domain.domain}</span>
                {domain.status === "verified" && (
                  <Badge className="gap-1">
                    <CheckCircle2 className="size-3" />
                    Verified
                  </Badge>
                )}
                {domain.status === "pending" && (
                  <Badge variant="secondary" className="gap-1">
                    <Clock className="size-3" />
                    Waiting for DNS
                  </Badge>
                )}
                {domain.status === "failed" && (
                  <Badge variant="secondary" className="gap-1">
                    <XCircle className="size-3" />
                    Failed
                  </Badge>
                )}
              </div>

              {!verified && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Add these to your DNS, then check again. Changes usually
                    appear within minutes but can take up to an hour.
                  </p>
                  <DnsRecords
                    records={(domain.dnsRecords as EmailDnsRecord[]) ?? []}
                  />
                </>
              )}

              <DomainActions verified={verified} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Inbox className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">Your own mailboxes</CardTitle>
          </div>
          <CardDescription>
            Real addresses on your own domain — yours to read here, on your
            phone, or in Outlook. This is separate from the sending setup above:
            that decides what leaves, this decides what arrives.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hosted === null ? (
            <SetupHostedDomainForm />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm">{hosted.domain}</span>
                {hosted.status === "active" && (
                  <Badge className="gap-1">
                    <CheckCircle2 className="size-3" />
                    Receiving mail
                  </Badge>
                )}
                {hosted.status === "dns_ready" && (
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="size-3" />
                    Ready to switch over
                  </Badge>
                )}
                {hosted.status === "pending" && (
                  <Badge variant="secondary" className="gap-1">
                    <Clock className="size-3" />
                    Waiting for DNS
                  </Badge>
                )}
                {hosted.status === "failed" && (
                  <Badge variant="secondary" className="gap-1">
                    <XCircle className="size-3" />
                    Rejected
                  </Badge>
                )}
              </div>

              {hosted.status !== "active" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Add these at your DNS provider. Mail keeps arriving where it
                    does today until the MX record below actually changes —
                    everything else here is preparation.
                  </p>
                  <DnsRecords
                    records={(hosted.dnsRecords as EmailDnsRecord[]) ?? []}
                  />
                </>
              )}

              {hosted.status !== "failed" && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">
                    Mailboxes ({mailboxes.length})
                  </h4>
                  {mailboxes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      None yet. Create everyone&apos;s mailbox before switching
                      over, so no mail bounces during the change.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Address</TableHead>
                            <TableHead className="hidden sm:table-cell">
                              Name
                            </TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {mailboxes.map((mailbox) => (
                            <TableRow key={mailbox.id}>
                              <TableCell className="font-mono text-sm break-all">
                                {mailbox.address}
                              </TableCell>
                              <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                                {mailbox.displayName || "—"}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    mailbox.invitePending
                                      ? "secondary"
                                      : "default"
                                  }
                                >
                                  {mailbox.invitePending
                                    ? "setup link sent"
                                    : mailbox.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <MailboxRowActions mailbox={mailbox} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <CreateMailboxForm domain={hosted.domain} />
                </div>
              )}

              {hosted.status === "dns_ready" && (
                <CutoverPanel
                  domain={hosted.domain}
                  previousProvider={describeMxProvider(
                    (hosted.previousMx as PreviousMxRecord[]) ?? [],
                  )}
                  mailboxCount={mailboxes.length}
                />
              )}

              {hosted.status === "active" && rollback && (
                <RollbackCard
                  records={rollback.records}
                  previousProvider={rollback.previousProvider}
                />
              )}

              <div className="flex flex-wrap gap-2">
                <CheckDnsButton status={hosted.status} />
                <DisconnectHostedDomainButton />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent email</CardTitle>
          <CardDescription>
            What the system has sent for you, and what happened to it. A bounce
            here means the message never arrived.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing sent yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>To</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Subject
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sent.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-sm">{row.toAddress}</TableCell>
                      <TableCell className="hidden max-w-xs truncate text-sm text-muted-foreground sm:table-cell">
                        {row.subject}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.status === "bounced" ||
                            row.status === "failed" ||
                            row.status === "complained"
                              ? "secondary"
                              : "default"
                          }
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {row.createdAt.toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
