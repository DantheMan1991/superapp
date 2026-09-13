import Link from "next/link";
import { MessageSquarePlus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import {
  FeedbackKindChip,
  FeedbackStatusChip,
} from "@/components/app/feedback-chips";
import { requireTenant } from "@/lib/auth";
import { listMyReports } from "@/lib/feedback/read";
import {
  formatWhen,
  hasUnreadReply,
  screenLabel,
} from "@/lib/feedback/core";

export const dynamic = "force-dynamic";

/**
 * YOUR REPORTS — everything this person has sent us, and what we said back.
 *
 * NOT IN THE NAV RAIL, and that is a decision rather than an oversight. The
 * rail is already thirteen rows at a tenant with a profile installed, and this
 * is a page somebody visits when they are owed an answer. The doors are the
 * report button's own sheet (on every screen) and the link in the reply email;
 * the dot on the button is what says there is a reason to come.
 *
 * ONLY THEIR OWN REPORTS REACH THIS PAGE, and the policy is what guarantees it
 * — `listMyReports` restates the clause, but a bug there would return nothing
 * rather than somebody else's. See ADR 0053 for why a workspace does not share
 * these.
 */
export default async function FeedbackPage() {
  const ctx = await requireTenant();
  const reports = await listMyReports(ctx);
  const zone = ctx.tenant.timezone;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your reports"
        description="What you have told us about, and what we said back. Only you can see these."
        icon={<MessageSquarePlus />}
      />

      <Panel
        isEmpty={reports.length === 0}
        empty={
          <EmptyState
            title="Nothing reported yet"
            description={
              <>
                Press the{" "}
                <MessageSquarePlus className="inline size-4 align-text-bottom" />{" "}
                beside the <strong>?</strong> on any screen to tell us something
                is broken, ask a question, or suggest a change. We answer here.
              </>
            }
            icon={<MessageSquarePlus />}
          />
        }
        className="divide-y divide-divider"
      >
        {reports.map((report) => {
          const unread = hasUnreadReply(report);
          return (
            <Link
              key={report.id}
              href={`/dashboard/feedback/${report.id}`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50"
            >
              {/* The dot sits in the row's own gutter rather than beside the
                  title, so a list of ten reports has one column to scan. */}
              <span
                aria-hidden
                className={
                  unread
                    ? "mt-2 size-2 shrink-0 rounded-full bg-destructive"
                    : "mt-2 size-2 shrink-0"
                }
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      unread ? "font-semibold" : "font-medium"
                    }
                  >
                    {report.title}
                  </span>
                  <FeedbackStatusChip status={report.status} side="client" />
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  <FeedbackKindChip
                    kind={report.kind}
                    side="client"
                    className="mr-2 align-middle"
                  />
                  {screenLabel(report.route)} · sent{" "}
                  {formatWhen(report.createdAt, zone)}
                  {unread && (
                    <span className="ml-2 font-medium text-destructive">
                      New reply
                    </span>
                  )}
                </p>
              </div>
            </Link>
          );
        })}
      </Panel>
    </div>
  );
}
