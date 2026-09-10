import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { withSystem, withTenant, schema } from "@/db";
import { getFeature } from "@/lib/features";
import { isQuiet } from "@/lib/last-seen";
import { getOperatorTenant } from "@/lib/operator-tenant";
import { loadAllRetainerViews } from "@/lib/retainer";

/**
 * Health signals (back-office slice 6): what the console can say about a
 * client without anybody typing anything.
 *
 *   - last seen — the newest `memberships.last_seen_at`, stamped by the
 *     member's own requests (src/lib/auth.ts), never by a support view;
 *   - activity — audit-log rows in the last thirty days, when the last was,
 *     and which FEATURES they clearly belonged to;
 *   - retainer — the existing month's math (src/lib/retainer-core.ts);
 *   - owes — the operator's open invoices for the client's party, read
 *     through the operator's own context (slice 5 is what put them there).
 *
 * Each becomes a CONCERN when it says something a superadmin should look at,
 * and the Clients list sorts by concern, so the table stops being a list of
 * names in the order they arrived.
 *
 * "Features used" is a best-effort reading of audit-log action prefixes. The
 * prefixes were named by hand over two months and do not all match a feature
 * slug, so the map below says which ones clearly do; a prefix it does not
 * name is COUNTED and never attributed. Honest about what it knows.
 */

export const ACTIVITY_WINDOW_DAYS = 30;

/** Sentinel key in the owed map: the operator answered, so absence means 0. */
const OPERATOR_REACHED = "__operator__";

const PREFIX_TO_FEATURE: Record<string, string> = {
  accounting: "accounting",
  ledger: "accounting",
  books: "accounting",
  bill: "accounting",
  invoice: "accounting",
  banking: "accounting",
  close: "accounting",
  deposit: "accounting",
  credit: "accounting",
  enterprise: "accounting",
  crm: "crm",
  documents: "documents",
  document: "documents",
  mail: "email",
  mailbox: "email",
  scheduling: "scheduling",
  work: "work",
  marketing: "marketing",
  site: "marketing",
  inventory: "inventory",
  livestock: "livestock",
  land: "land",
  asset: "assets",
  assets: "assets",
  production: "production",
  retail: "retail",
};

/** Attribute an action's prefix to a feature the registry knows, or nothing. */
export function featureForPrefix(prefix: string): string | null {
  const slug = PREFIX_TO_FEATURE[prefix];
  return slug && getFeature(slug) ? slug : null;
}

export type Concern =
  | "never_signed_in"
  | "quiet"
  | "over_retainer"
  | "past_due"
  | "owes";

export const CONCERN_WORDS: Record<Concern, string> = {
  never_signed_in: "Never signed in",
  quiet: "Quiet 30 days",
  over_retainer: "Over retainer",
  past_due: "Past due",
  owes: "Owes",
};

/** Sorting weight: what a superadmin should look at first. */
const CONCERN_WEIGHT: Record<Concern, number> = {
  past_due: 8,
  over_retainer: 4,
  owes: 2,
  quiet: 1,
  never_signed_in: 1,
};

export interface HealthSignals {
  tenantId: string;
  lastSeenAt: Date | null;
  activity: { count: number; lastAt: Date | null; features: string[] };
  retainer: {
    hasAny: boolean;
    isOver: boolean;
    isNearLimit: boolean;
    unpaidOverageMinutes: number;
  } | null;
  /** Null when the client has no party in the operator's CRM, or no operator is named. */
  owesCents: number | null;
  concerns: Concern[];
  concernScore: number;
}

export interface HealthSubject {
  id: string;
  operatorPartyId: string | null;
  subscriptionStatus: string | null;
}

export async function loadHealthSignals(
  subjects: HealthSubject[],
  now: Date = new Date(),
): Promise<Map<string, HealthSignals>> {
  const out = new Map<string, HealthSignals>();
  if (subjects.length === 0) return out;
  const ids = subjects.map((s) => s.id);
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60_000);

  const [seen, activity, retainers] = await withSystem(async (tx) =>
    Promise.all([
      tx
        .select({
          tenantId: schema.memberships.tenantId,
          lastSeenAt: sql<Date | null>`max(${schema.memberships.lastSeenAt})`,
        })
        .from(schema.memberships)
        .where(inArray(schema.memberships.tenantId, ids))
        .groupBy(schema.memberships.tenantId),
      tx
        .select({
          tenantId: schema.auditLog.tenantId,
          count: sql<number>`count(*)::int`,
          lastAt: sql<Date | null>`max(${schema.auditLog.createdAt})`,
          prefixes: sql<string[]>`array_agg(distinct split_part(${schema.auditLog.action}, '.', 1))`,
        })
        .from(schema.auditLog)
        .where(and(inArray(schema.auditLog.tenantId, ids), gt(schema.auditLog.createdAt, since)))
        .groupBy(schema.auditLog.tenantId),
      loadAllRetainerViews(tx, now),
    ]),
  );
  const seenBy = new Map(seen.map((r) => [r.tenantId, r.lastSeenAt ? new Date(r.lastSeenAt) : null]));
  const activityBy = new Map(
    activity.map((r) => [
      r.tenantId as string,
      {
        count: r.count,
        lastAt: r.lastAt ? new Date(r.lastAt) : null,
        features: Array.from(
          new Set((r.prefixes ?? []).map(featureForPrefix).filter((f): f is string => f !== null)),
        ).sort(),
      },
    ]),
  );

  const owesBy = await loadOwed(subjects);

  for (const s of subjects) {
    const lastSeenAt = seenBy.get(s.id) ?? null;
    const act = activityBy.get(s.id) ?? { count: 0, lastAt: null, features: [] };
    const view = retainers.get(s.id);
    const retainer = view
      ? {
          hasAny: view.hasAnyData,
          isOver: view.usage.isOver,
          isNearLimit: view.usage.isNearLimit,
          unpaidOverageMinutes: view.usage.unpaidOverageMinutes,
        }
      : null;
    // Known only when the client has a party AND the operator was reachable;
    // then a party with no open invoice owes 0 rather than unknown.
    const owesCents =
      s.operatorPartyId && owesBy.has(OPERATOR_REACHED)
        ? (owesBy.get(s.operatorPartyId) ?? 0)
        : null;

    const concerns: Concern[] = [];
    if (s.subscriptionStatus === "past_due") concerns.push("past_due");
    if (retainer?.isOver) concerns.push("over_retainer");
    if (owesCents !== null && owesCents > 0) concerns.push("owes");
    if (!lastSeenAt && act.count === 0) concerns.push("never_signed_in");
    else if (isQuiet(lastSeenAt, act.lastAt, now)) concerns.push("quiet");

    out.set(s.id, {
      tenantId: s.id,
      lastSeenAt,
      activity: act,
      retainer,
      owesCents,
      concerns,
      concernScore: concerns.reduce((sum, c) => sum + CONCERN_WEIGHT[c], 0),
    });
  }
  return out;
}

/**
 * What each party owes the operator: open invoices less what has been paid
 * or credited against them, summed per party — the same arithmetic
 * `paidCentsFor` does, over the set at once. Read through the OPERATOR's
 * context as staff. Answers a map keyed by party id, plus a sentinel
 * `__operator__` entry that says the operator was reachable at all, so a
 * party with no open invoice reads as 0 rather than unknown.
 */
async function loadOwed(subjects: HealthSubject[]): Promise<Map<string, number>> {
  const owes = new Map<string, number>();
  const partyIds = subjects.flatMap((s) => (s.operatorPartyId ? [s.operatorPartyId] : []));
  if (partyIds.length === 0) return owes;
  const operator = await getOperatorTenant();
  if (!operator) return owes;
  owes.set(OPERATOR_REACHED, 0);

  const rows = await withTenant(
    operator.id,
    (tx) =>
      tx
        .select({
          partyId: schema.customers.partyId,
          total: schema.invoices.totalCents,
          paid: sql<string>`coalesce((select sum(p.amount_cents) from invoice_payments p where p.tenant_id = ${schema.invoices.tenantId} and p.invoice_id = ${schema.invoices.id}), 0)`,
        })
        .from(schema.invoices)
        .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId))
        .where(
          and(
            eq(schema.invoices.tenantId, operator.id),
            inArray(schema.customers.partyId, partyIds),
            inArray(schema.invoices.status, ["issued", "partial"]),
          ),
        ),
    { role: "staff" },
  );
  for (const r of rows) {
    const due = Number(r.total) - Number(r.paid);
    owes.set(r.partyId, (owes.get(r.partyId) ?? 0) + Math.max(0, due));
  }
  return owes;
}
