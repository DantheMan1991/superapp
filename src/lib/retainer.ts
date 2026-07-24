import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import * as schema from "@/db/schema";
import type { Retainer } from "@/db/schema";
import {
  computeRetainerUsage,
  currentMonth,
  type AllotmentChange,
  type MonthlyUsed,
  type RetainerUsage,
} from "@/lib/retainer-core";

export interface RetainerView {
  usage: RetainerUsage;
  /** Timer state + current-allotment display value; null until first use. */
  retainer: Retainer | null;
  /** False = tenant has never had a retainer configured or any activity. */
  hasAnyData: boolean;
}

/**
 * Assemble the derived retainer picture on the caller's transaction — works
 * under both withTenant (member_read policies) and withSystem.
 */
export async function loadRetainerView(
  tx: Tx,
  tenantId: string,
  now: Date = new Date(),
): Promise<RetainerView> {
  const [monthly, purchased, allotments, retainer] = await Promise.all([
    tx
      .select({
        month: sql<string>`to_char(${schema.retainerTimeEntries.workDate}, 'YYYY-MM')`,
        minutes: sql<number>`sum(${schema.retainerTimeEntries.minutes})::int`,
      })
      .from(schema.retainerTimeEntries)
      .where(eq(schema.retainerTimeEntries.tenantId, tenantId))
      .groupBy(sql`1`),
    tx
      .select({
        minutes: sql<number>`coalesce(sum(${schema.retainerPurchases.minutes}), 0)::int`,
      })
      .from(schema.retainerPurchases)
      .where(eq(schema.retainerPurchases.tenantId, tenantId)),
    tx.query.retainerAllotments.findMany({
      where: eq(schema.retainerAllotments.tenantId, tenantId),
      orderBy: [asc(schema.retainerAllotments.effectiveMonth)],
    }),
    tx.query.retainers.findFirst({
      where: eq(schema.retainers.tenantId, tenantId),
    }),
  ]);

  const monthlyUsed: MonthlyUsed[] = monthly;
  const purchasedMinutesTotal = purchased[0]?.minutes ?? 0;
  const history: AllotmentChange[] = allotments.map((a) => ({
    effectiveMonth: a.effectiveMonth,
    includedMinutes: a.includedMinutes,
  }));

  return {
    usage: computeRetainerUsage({
      monthlyUsed,
      purchasedMinutesTotal,
      allotments: history,
      month: currentMonth(now),
    }),
    retainer: retainer ?? null,
    hasAnyData:
      retainer != null || monthlyUsed.length > 0 || purchasedMinutesTotal > 0,
  };
}

/**
 * Admin list view: the same derived picture for every tenant that has any
 * retainer data, in four set-based queries (no per-tenant round trips).
 */
export async function loadAllRetainerViews(
  tx: Tx,
  now: Date = new Date(),
): Promise<Map<string, RetainerView>> {
  const [monthly, purchased, allotments, retainerRows] = await Promise.all([
    tx
      .select({
        tenantId: schema.retainerTimeEntries.tenantId,
        month: sql<string>`to_char(${schema.retainerTimeEntries.workDate}, 'YYYY-MM')`,
        minutes: sql<number>`sum(${schema.retainerTimeEntries.minutes})::int`,
      })
      .from(schema.retainerTimeEntries)
      .groupBy(schema.retainerTimeEntries.tenantId, sql`2`),
    tx
      .select({
        tenantId: schema.retainerPurchases.tenantId,
        minutes: sql<number>`sum(${schema.retainerPurchases.minutes})::int`,
      })
      .from(schema.retainerPurchases)
      .groupBy(schema.retainerPurchases.tenantId),
    tx.query.retainerAllotments.findMany({
      orderBy: [asc(schema.retainerAllotments.effectiveMonth)],
    }),
    tx.query.retainers.findMany(),
  ]);

  const byTenant = new Map<
    string,
    {
      monthlyUsed: MonthlyUsed[];
      purchasedMinutesTotal: number;
      allotments: AllotmentChange[];
      retainer: Retainer | null;
    }
  >();
  const bucket = (tenantId: string) => {
    let b = byTenant.get(tenantId);
    if (!b) {
      b = {
        monthlyUsed: [],
        purchasedMinutesTotal: 0,
        allotments: [],
        retainer: null,
      };
      byTenant.set(tenantId, b);
    }
    return b;
  };

  for (const m of monthly) {
    bucket(m.tenantId).monthlyUsed.push({ month: m.month, minutes: m.minutes });
  }
  for (const p of purchased) {
    bucket(p.tenantId).purchasedMinutesTotal = p.minutes;
  }
  for (const a of allotments) {
    bucket(a.tenantId).allotments.push({
      effectiveMonth: a.effectiveMonth,
      includedMinutes: a.includedMinutes,
    });
  }
  for (const r of retainerRows) {
    bucket(r.tenantId).retainer = r;
  }

  const month = currentMonth(now);
  const views = new Map<string, RetainerView>();
  for (const [tenantId, b] of byTenant) {
    views.set(tenantId, {
      usage: computeRetainerUsage({
        monthlyUsed: b.monthlyUsed,
        purchasedMinutesTotal: b.purchasedMinutesTotal,
        allotments: b.allotments,
        month,
      }),
      retainer: b.retainer,
      hasAnyData: true,
    });
  }
  return views;
}
