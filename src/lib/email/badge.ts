import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@/db";

/**
 * The unread count for the sidebar.
 *
 * THE CONSTRAINT THAT SHAPES THIS: `dashboard/layout.tsx` is `force-dynamic`
 * and renders on EVERY dashboard navigation. A JMAP call here would put
 * mail-server latency on the invoice list, the document browser and every other
 * page in the product — including for tenants who have never opened Mail.
 *
 * So this is one indexed SELECT against a number that sync already wrote. It is
 * stale by at most one sync interval, and accepting that staleness is the entire
 * reason `mail_accounts.inbox_unread` exists.
 *
 * Scoped through `withTenant(..., { userId })`, so the per-user policy from
 * `0043` is what limits it to this person's own connections — the badge cannot
 * accidentally total a colleague's mail.
 */

export interface MailBadge {
  count: number;
  /** A mailbox that needs reconnecting. Shown as a dot, never as a number. */
  needsAttention: boolean;
}

export async function getMailBadge(
  tenantId: string,
  clerkUserId: string,
  role: "owner" | "staff" | "expert",
): Promise<MailBadge> {
  // The external accountant has no mail access at all, so there is nothing to
  // count and no query worth running.
  if (role === "expert") return { count: 0, needsAttention: false };

  try {
    const [row] = await withTenant(
      tenantId,
      (tx) =>
        tx
          .select({
            unread: sql<number>`coalesce(sum(${schema.mailAccounts.inboxUnread}), 0)`,
            broken: sql<number>`count(*) filter (where ${schema.mailAccounts.status} <> 'connected')`,
          })
          .from(schema.mailAccounts)
          .where(and(eq(schema.mailAccounts.tenantId, tenantId))),
      { role, userId: clerkUserId },
    );

    return {
      count: Number(row?.unread ?? 0),
      needsAttention: Number(row?.broken ?? 0) > 0,
    };
  } catch (err) {
    // A badge is decoration. It must never be the reason a dashboard page
    // fails to render.
    console.error("mail: badge lookup failed", err);
    return { count: 0, needsAttention: false };
  }
}
