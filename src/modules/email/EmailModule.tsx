import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Mail,
  Users,
} from "lucide-react";
import type { TenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { mailOauthProvider } from "@/lib/email/oauth/config";
import { loadMailHome } from "./connections";
import { MailView } from "./MailView";
import {
  ConnectMailboxButton,
  DisconnectMailboxButton,
} from "./components/connect-controls";

/**
 * Mail's home while nothing is connected: the gateway into the inbox.
 *
 * Everything here is a way in. Once a mailbox is connected this page becomes
 * the three-pane reader; until then its whole job is to explain, honestly, what
 * is standing between this person and their mail — and to make the next step
 * one click.
 *
 * The module renders its own padding because it declares `layout: "full"`; the
 * shell hands full-width modules the viewport and no chrome at all.
 */
export async function EmailModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const configured = mailOauthProvider() !== null;
  const { connectable, orphaned, noMailboxes } = await loadMailHome(
    ctx.tenant.id,
    ctx.userId,
  );

  const connected = connectable.filter(
    (row) => row.account?.status === "connected",
  );

  // A live connection means this module IS the inbox. The setup screen below is
  // what you see before there is one — and it stays reachable at ?setup=1, so
  // connecting a second mailbox or disconnecting is never a dead end.
  const wantsSetup = searchParams.setup === "1";
  if (connected.length > 0 && connected[0].account && !wantsSetup) {
    return (
      <MailView
        ctx={ctx}
        account={connected[0].account}
        searchParams={searchParams}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="space-y-6">
        <PageHeader
          title="Mail"
          description="Your business mailbox, beside the work it's about."
          icon={<Mail />}
        />

        {!configured ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Reading mail isn&apos;t switched on yet
              </CardTitle>
              <CardDescription>
                This business&apos;s mail server hasn&apos;t been connected to
                Yosher. Nothing is wrong with your mailbox — it keeps receiving
                mail exactly as it does today, and you can still read it on your
                phone or in Outlook.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Your administrator sets this up once, for everyone.
              </p>
            </CardContent>
          </Card>
        ) : noMailboxes ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No mailboxes yet</CardTitle>
              <CardDescription>
                Mail reads the addresses on your own domain. This business
                doesn&apos;t have any set up yet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ctx.role === "owner" ? (
                <p className="text-sm text-muted-foreground">
                  Set up your domain and create the first mailboxes in{" "}
                  <Link
                    href="/dashboard/email"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Email setup
                  </Link>
                  .
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The business owner creates these. Ask them for an address on
                  the company domain, and it will appear here.
                </p>
              )}
            </CardContent>
          </Card>
        ) : connectable.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                No mailbox for you yet
              </CardTitle>
              <CardDescription>
                This business has mailboxes, but none of them is yours and none
                is shared with everyone.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Ask the business owner for an address on the company domain.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Inbox className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">Your mailboxes</CardTitle>
              </div>
              <CardDescription>
                Connecting sends you to your mail server to authorize Yosher.
                Your password never passes through this app — you approve it
                there, and we keep a token we can revoke.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="divide-y rounded-md border">
                {connectable.map(({ mailbox, account, shared }) => (
                  <div
                    key={mailbox.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm">
                        {mailbox.address}
                      </p>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {mailbox.displayName || "—"}
                        {shared && (
                          <span className="inline-flex items-center gap-1">
                            <Users className="size-3" />
                            Shared
                          </span>
                        )}
                      </p>
                    </div>

                    {account?.status === "connected" && (
                      <Badge className="gap-1">
                        <CheckCircle2 className="size-3" />
                        Connected
                      </Badge>
                    )}
                    {account?.status === "needs_reauth" && (
                      <Badge variant="secondary" className="gap-1">
                        <AlertTriangle className="size-3" />
                        Needs reconnecting
                      </Badge>
                    )}

                    <div className="flex items-center gap-1">
                      {account === null ? (
                        <ConnectMailboxButton mailboxId={mailbox.id} />
                      ) : (
                        <>
                          {account.status !== "connected" && (
                            <ConnectMailboxButton
                              mailboxId={mailbox.id}
                              reconnect
                            />
                          )}
                          <DisconnectMailboxButton
                            mailboxId={mailbox.id}
                            address={mailbox.address}
                          />
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {connected.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Reading mail inside Yosher arrives in the next update. Until
                  then this connection is stored and ready — your mail keeps
                  working on your phone and in Outlook exactly as it does now.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {orphaned.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Connections without a mailbox
              </CardTitle>
              <CardDescription>
                These addresses were removed from the business, but the
                connection is still here. Clearing it changes nothing else.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y rounded-md border">
                {orphaned.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      Mailbox no longer exists
                    </p>
                    <DisconnectMailboxButton
                      mailboxId={account.mailboxId}
                      address="this mailbox"
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
