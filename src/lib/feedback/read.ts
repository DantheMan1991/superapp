import "server-only";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "@/db";
import type { TenantContext } from "@/lib/auth";

/**
 * Reading feedback — BOTH sides, one file, and the `withSystem` half is
 * marked as loudly as the language allows.
 *
 * The client's reads run in the reporter's own transaction, so RLS is what
 * decides what comes back and the queries below restate the same predicates
 * anyway (defence in depth: neither layer is trusted alone, architecture.md).
 * The console's reads run `withSystem` and span every tenant — they are
 * callable only from `/admin`, behind `requireSuperAdmin()`, and every one of
 * them says so on its own comment rather than relying on the reader knowing
 * which half of the file they are in.
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface ReportRow {
  id: string;
  kind: string;
  status: string;
  title: string;
  route: string;
  routeQuery: string;
  featureSlug: string;
  createdAt: Date;
  updatedAt: Date;
  clientReadAt: Date | null;
  operatorReadAt: Date | null;
  /** Newest message from us that the client is allowed to see. */
  lastOperatorMessageAt: Date | null;
  /** Newest message from them. */
  lastClientMessageAt: Date | null;
  messageCount: number;
}

export interface ConsoleReportRow extends ReportRow {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  /**
   * The CLIENT's clock. The thread page stamps every message with it, because
   * "I did this at 8am" only lines up if both people read the same times, and
   * the person who was there is the one whose clock is authoritative.
   */
  tenantTimezone: string;
  isOperatorTenant: boolean;
  reporterName: string;
  reporterEmail: string;
  surface: string;
  appVersion: string;
}

export interface ThreadMessage {
  id: string;
  side: string;
  authorName: string;
  clerkUserId: string;
  body: string;
  internal: boolean;
  createdAt: Date;
}

/**
 * The two correlated aggregates every list needs. Written once here because a
 * console list and a client list that computed "last replied" two different
 * ways would disagree about whose move it is — and whose move it is is the
 * only thing either list sorts by.
 *
 * `internal = false` on the operator side is NOT a client-only filter. The
 * console reads the real thread separately; what this column answers is "when
 * did the CLIENT last hear from us", and a note they cannot see is not a
 * thing they heard.
 */
const lastOperatorMessageAt = sql<Date | null>`(
  select max(m."created_at") from "feedback_messages" m
  where m."report_id" = "feedback_reports"."id"
    and m."side" = 'operator' and m."internal" = false
)`;

const lastClientMessageAt = sql<Date | null>`(
  select max(m."created_at") from "feedback_messages" m
  where m."report_id" = "feedback_reports"."id" and m."side" = 'client'
)`;

const visibleMessageCount = sql<number>`(
  select count(*)::int from "feedback_messages" m
  where m."report_id" = "feedback_reports"."id" and m."internal" = false
)`;

const reportColumns = {
  id: schema.feedbackReports.id,
  kind: schema.feedbackReports.kind,
  status: schema.feedbackReports.status,
  title: schema.feedbackReports.title,
  route: schema.feedbackReports.route,
  routeQuery: schema.feedbackReports.routeQuery,
  featureSlug: schema.feedbackReports.featureSlug,
  createdAt: schema.feedbackReports.createdAt,
  updatedAt: schema.feedbackReports.updatedAt,
  clientReadAt: schema.feedbackReports.clientReadAt,
  operatorReadAt: schema.feedbackReports.operatorReadAt,
  lastOperatorMessageAt,
  lastClientMessageAt,
  messageCount: visibleMessageCount,
};

// ---------------------------------------------------------------------------
// The client's own side
// ---------------------------------------------------------------------------

/** Run something as the signed-in person, which is what the policy keys on. */
function asReporter<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) {
  return withTenant(ctx.tenant.id, fn, {
    role: ctx.role,
    userId: ctx.userId,
  });
}

/** Everything this person has sent us, newest first. */
export async function listMyReports(
  ctx: TenantContext,
): Promise<ReportRow[]> {
  return asReporter(ctx, (tx) =>
    tx
      .select(reportColumns)
      .from(schema.feedbackReports)
      .where(eq(schema.feedbackReports.clerkUserId, ctx.userId))
      .orderBy(desc(schema.feedbackReports.createdAt))
      .limit(200),
  );
}

/**
 * HOW MANY OF THEIR REPORTS HAVE AN ANSWER THEY HAVE NOT READ.
 *
 * This runs in the DASHBOARD LAYOUT, on every page in the product, which is
 * the whole reason it is a single indexed count and not a list. `getMailBadge`
 * set the bar and the same rule applies: one SELECT against rows the person
 * already owns, never a join across a module.
 *
 * A support view is NOT a reader here — a superadmin looking at a client's
 * workspace is not the client, and a dot on their button counting somebody
 * else's replies would be a lie in both directions. The caller checks.
 */
export async function countUnreadReplies(ctx: TenantContext): Promise<number> {
  const rows = await asReporter(ctx, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.feedbackReports)
      .where(
        and(
          eq(schema.feedbackReports.clerkUserId, ctx.userId),
          sql`exists (
            select 1 from "feedback_messages" m
            where m."report_id" = "feedback_reports"."id"
              and m."side" = 'operator'
              and m."internal" = false
              and (
                "feedback_reports"."client_read_at" is null
                or m."created_at" > "feedback_reports"."client_read_at"
              )
          )`,
        ),
      ),
  );
  return rows[0]?.n ?? 0;
}

/** One of their reports and its thread, or null if it is not theirs. */
export async function getMyReport(
  ctx: TenantContext,
  id: string,
): Promise<{ report: ReportRow; messages: ThreadMessage[] } | null> {
  return asReporter(ctx, async (tx) => {
    const [report] = await tx
      .select(reportColumns)
      .from(schema.feedbackReports)
      .where(
        and(
          eq(schema.feedbackReports.id, id),
          eq(schema.feedbackReports.clerkUserId, ctx.userId),
        ),
      )
      .limit(1);
    if (!report) return null;
    // `internal = false` restated in SQL rather than filtered in code. The
    // policy already refuses these rows; saying it twice is what makes a
    // future change to the policy fail a test instead of leaking a note.
    const messages = await tx
      .select({
        id: schema.feedbackMessages.id,
        side: schema.feedbackMessages.side,
        authorName: schema.feedbackMessages.authorName,
        clerkUserId: schema.feedbackMessages.clerkUserId,
        body: schema.feedbackMessages.body,
        internal: schema.feedbackMessages.internal,
        createdAt: schema.feedbackMessages.createdAt,
      })
      .from(schema.feedbackMessages)
      .where(
        and(
          eq(schema.feedbackMessages.reportId, id),
          eq(schema.feedbackMessages.internal, false),
        ),
      )
      .orderBy(asc(schema.feedbackMessages.createdAt));
    return { report, messages };
  });
}

// ---------------------------------------------------------------------------
// The console. EVERY FUNCTION BELOW READS EVERY TENANT.
// ---------------------------------------------------------------------------

export interface ConsoleFilter {
  /** A FEEDBACK_STATUSES value, "open" for everything unfinished, or "" for all. */
  status?: string;
  kind?: string;
  tenantId?: string;
}

/**
 * THE GOD VIEW. `withSystem`, across every workspace — callable only from
 * `/admin`, which `requireSuperAdmin()` has already gated in the layout AND in
 * each page. Nothing in `/dashboard` may import this.
 *
 * Ordered by whose move it is and then oldest first WITHIN the waiting group,
 * because a report that has been waiting three days beats one that arrived
 * this morning; everything settled follows newest first. `queueRank` in
 * core.ts is the same rule for a caller that already has the rows.
 */
export async function listReportsForConsole(
  filter: ConsoleFilter = {},
): Promise<ConsoleReportRow[]> {
  const clauses: SQL[] = [];
  if (filter.status === "open") {
    clauses.push(sql`"feedback_reports"."closed_at" is null`);
  } else if (filter.status) {
    clauses.push(eq(schema.feedbackReports.status, filter.status));
  }
  if (filter.kind) clauses.push(eq(schema.feedbackReports.kind, filter.kind));
  if (filter.tenantId) {
    clauses.push(eq(schema.feedbackReports.tenantId, filter.tenantId));
  }

  return withSystem((tx) =>
    tx
      .select({
        ...reportColumns,
        tenantId: schema.feedbackReports.tenantId,
        tenantName: schema.tenants.name,
        tenantSlug: schema.tenants.slug,
        tenantTimezone: schema.tenants.timezone,
        isOperatorTenant: schema.tenants.isOperator,
        reporterName: schema.feedbackReports.reporterName,
        reporterEmail: schema.feedbackReports.reporterEmail,
        surface: schema.feedbackReports.surface,
        appVersion: schema.feedbackReports.appVersion,
      })
      .from(schema.feedbackReports)
      .innerJoin(
        schema.tenants,
        eq(schema.tenants.id, schema.feedbackReports.tenantId),
      )
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(
        // Waiting on us first. Repeated in SQL rather than sorted in JS
        // because the list is paged and a page boundary would otherwise put
        // half the queue on page two.
        sql`case
          when "feedback_reports"."status" = 'new' then 0
          when (
            select max(m."created_at") from "feedback_messages" m
            where m."report_id" = "feedback_reports"."id" and m."side" = 'client'
          ) > coalesce("feedback_reports"."operator_read_at", 'epoch'::timestamptz)
            then 0
          else 1 end`,
        sql`case
          when "feedback_reports"."status" = 'new' then "feedback_reports"."created_at"
          else null end asc nulls last`,
        desc(schema.feedbackReports.createdAt),
      )
      .limit(300),
  );
}

/** THE GOD VIEW. One report, its workspace and its WHOLE thread — notes included. */
export async function getReportForConsole(id: string): Promise<{
  report: ConsoleReportRow;
  messages: ThreadMessage[];
  userAgent: string;
  viewport: string;
} | null> {
  return withSystem(async (tx) => {
    const [report] = await tx
      .select({
        ...reportColumns,
        tenantId: schema.feedbackReports.tenantId,
        tenantName: schema.tenants.name,
        tenantSlug: schema.tenants.slug,
        tenantTimezone: schema.tenants.timezone,
        isOperatorTenant: schema.tenants.isOperator,
        reporterName: schema.feedbackReports.reporterName,
        reporterEmail: schema.feedbackReports.reporterEmail,
        surface: schema.feedbackReports.surface,
        appVersion: schema.feedbackReports.appVersion,
        userAgent: schema.feedbackReports.userAgent,
        viewport: schema.feedbackReports.viewport,
      })
      .from(schema.feedbackReports)
      .innerJoin(
        schema.tenants,
        eq(schema.tenants.id, schema.feedbackReports.tenantId),
      )
      .where(eq(schema.feedbackReports.id, id))
      .limit(1);
    if (!report) return null;
    const messages = await tx
      .select({
        id: schema.feedbackMessages.id,
        side: schema.feedbackMessages.side,
        authorName: schema.feedbackMessages.authorName,
        clerkUserId: schema.feedbackMessages.clerkUserId,
        body: schema.feedbackMessages.body,
        internal: schema.feedbackMessages.internal,
        createdAt: schema.feedbackMessages.createdAt,
      })
      .from(schema.feedbackMessages)
      .where(eq(schema.feedbackMessages.reportId, id))
      .orderBy(asc(schema.feedbackMessages.createdAt));
    const { userAgent, viewport, ...rest } = report;
    return { report: rest, messages, userAgent, viewport };
  });
}

/**
 * THE GOD VIEW. How many reports are waiting on us — the number on the console's
 * nav row. One count, no rows, because the admin layout renders it on every
 * page there.
 */
export async function countReportsNeedingOperator(): Promise<number> {
  const rows = await withSystem((tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.feedbackReports)
      .where(sql`
        "feedback_reports"."status" = 'new'
        or (
          "feedback_reports"."closed_at" is null
          and (
            select max(m."created_at") from "feedback_messages" m
            where m."report_id" = "feedback_reports"."id" and m."side" = 'client'
          ) > coalesce("feedback_reports"."operator_read_at", 'epoch'::timestamptz)
        )`),
  );
  return rows[0]?.n ?? 0;
}
