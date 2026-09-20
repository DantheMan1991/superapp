import { headers } from "next/headers";
import { HardHat } from "lucide-react";
import { hashIp } from "@/lib/public-token";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { countInvitationView } from "@/packs/jobs/bids-ops";
import { GENERIC_GONE, resolveBidInvitation } from "@/packs/jobs/bid-share";
import { ReplyForm } from "./reply-form";

export const dynamic = "force-dynamic";

/**
 * A SUBCONTRACTOR'S VIEW OF A BID REQUEST (X3, ADR 0098).
 *
 * No sign-in, no nav, and no tenant data beyond what was deliberately sent:
 * the scope, when a number is wanted by, and where the job is. Never the
 * estimate, never the other bidders, never what anybody else said.
 *
 * Every failure — unknown token, revoked, expired, the request closed, the
 * pack switched off, the tenant gone — renders the SAME page with the SAME
 * words, so a visitor holding a dud token learns nothing about whether it
 * was ever real.
 */
export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function BidPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const head = await headers();
  const ipHash = hashIp(head.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "");

  const resolved = await resolveBidInvitation(token, ipHash);
  if (!resolved.ok || !resolved.pkg || !resolved.invitation) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <EmptyState icon={<HardHat />} title={GENERIC_GONE} description="" />
      </div>
    );
  }

  const { pkg, invitation, tenantName, jobLabel, acceptsReply } = resolved;
  /** Counted after the page is known to render, and never fatal. */
  await countInvitationView(resolved.tenantId!, invitation.id);

  const answered = invitation.repliedAt !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <PageHeader
        icon={<HardHat />}
        title={pkg.title}
        description={`${tenantName} is asking for a price.${jobLabel ? ` ${jobLabel}` : ""}`}
      />

      <Panel className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">What is being priced</p>
          {pkg.dueOn && <Badge variant="secondary">Wanted by {pkg.dueOn}</Badge>}
        </div>
        {pkg.scope ? (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{pkg.scope}</p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No scope was written out. Ask them before you price it.
          </p>
        )}
      </Panel>

      <Panel className="p-5">
        {answered ? (
          /**
           * THEY CAME BACK TO CHECK WHAT THEY SENT. Showing it is the point
           * of leaving the door open after a reply; `acceptsReply` is what
           * stops them sending a second.
           */
          <div className="space-y-2">
            <p className="text-sm font-medium">You have already answered this one.</p>
            <p className="text-sm">
              {invitation.declined
                ? "You said you are not bidding it."
                : `You sent ${formatMoney(invitation.amountCents ?? 0, "$")}.`}
            </p>
            {invitation.replyNote && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {invitation.replyNote}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Ring them if it needs changing — this page will not send a second.
            </p>
          </div>
        ) : acceptsReply ? (
          <ReplyForm token={token} symbol="$" />
        ) : (
          <p className="text-sm text-muted-foreground">
            This one is no longer taking prices.
          </p>
        )}
      </Panel>
    </div>
  );
}
