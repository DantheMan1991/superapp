import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { todayInTimezone } from "@/lib/timezone";
import { FoodError } from "./core/errors";
import { KNOWN_ITEMS_MAX, LINES_PER_READ, namesPrompt, normalizeNames } from "./core/list-names";
import { listLines, type LineName, type ListCook, type ListFood } from "./core/list";
import { plannable } from "./core/week";
import { callNamesModel, type NamesModel } from "./list-model";

/**
 * THE SHOPPING LIST, KEPT (D3, docs/modules/food.md, ADR 0130): what the
 * planned days ask for (their cooks' recipe lines and their planned foods),
 * what each line buys as Claude named it once for the space, and what the
 * person always has. Nothing about a shopping trip is kept here: the ticks and
 * the person's own items are on the phone. Every read and write takes the
 * space's own transaction; the tenant in each `where` is the second lock.
 */

const p = schema.foodPlan;

/** The cooks and planned foods in a run of days, both ends included, with each cook's recipe lines (not its headings). */
export async function shoppingPlan(
  tx: Tx,
  tenantId: string,
  from: string,
  to: string,
): Promise<{ cooks: ListCook[]; foods: ListFood[] }> {
  const r = schema.foodRecipes;
  const cookRows = await tx
    .select({
      planId: p.id,
      day: p.plannedOn,
      title: r.title,
      yieldAmount: r.yieldAmount,
      make: p.make,
      ingredients: r.ingredients,
    })
    .from(p)
    .innerJoin(r, and(eq(r.tenantId, p.tenantId), eq(r.id, p.recipeId)))
    .where(and(eq(p.tenantId, tenantId), eq(p.kind, "cook"), gte(p.plannedOn, from), lte(p.plannedOn, to)))
    .orderBy(asc(p.plannedOn), asc(p.createdAt));
  const foodRows = await tx
    .select({ planId: p.id, day: p.plannedOn, name: p.name, amount: p.amount, portion: p.portion, grams: p.grams })
    .from(p)
    .where(and(eq(p.tenantId, tenantId), eq(p.kind, "food"), gte(p.plannedOn, from), lte(p.plannedOn, to)))
    .orderBy(asc(p.plannedOn), asc(p.createdAt));
  return {
    cooks: cookRows.map((row) => ({
      planId: row.planId,
      day: row.day,
      title: row.title,
      yieldAmount: row.yieldAmount,
      make: row.make ?? 1,
      lines: (row.ingredients ?? []).filter((line) => !line.heading).map((line) => line.text),
    })),
    foods: foodRows.flatMap((row) =>
      row.name && row.amount !== null && row.portion && row.grams !== null
        ? [{ planId: row.planId, day: row.day, name: row.name, amount: row.amount, portion: row.portion, grams: row.grams }]
        : [],
    ),
  };
}

/** What each of these lines buys, for those already named: one thing or several to a line. */
export async function lineNames(tx: Tx, tenantId: string, lines: readonly string[]): Promise<Record<string, LineName[]>> {
  if (lines.length === 0) return {};
  const t = schema.foodLineNames;
  const rows = await tx
    .select({ line: t.line, item: t.item, aisle: t.aisle, staple: t.staple })
    .from(t)
    .where(and(eq(t.tenantId, tenantId), inArray(t.line, [...lines])))
    .orderBy(asc(t.createdAt), asc(t.item));
  const out: Record<string, LineName[]> = {};
  for (const row of rows) (out[row.line] ??= []).push({ item: row.item, aisle: row.aisle, staple: row.staple });
  return out;
}

/** The names the space's lists already use, the newest first: sent with new lines so one thing keeps one name. */
export async function knownItems(tx: Tx, tenantId: string): Promise<string[]> {
  const t = schema.foodLineNames;
  const rows = await tx
    .select({ item: t.item, last: sql<string>`max(${t.createdAt})` })
    .from(t)
    .where(and(eq(t.tenantId, tenantId), sql`${t.item} is not null`))
    .groupBy(t.item)
    .orderBy(desc(sql`max(${t.createdAt})`))
    .limit(KNOWN_ITEMS_MAX);
  return rows.flatMap((row) => (row.item ? [row.item] : []));
}

/** What the person always has: left off every list. */
export async function alwaysHave(tx: Tx, tenantId: string): Promise<string[]> {
  const t = schema.foodStaples;
  const rows = await tx.select({ item: t.item }).from(t).where(eq(t.tenantId, tenantId)).orderBy(asc(t.item));
  return rows.map((row) => row.item);
}

/** "Always have", or put back on the list. Done already is fine. */
export async function setAlwaysHave(tx: Tx, tenantId: string, item: string, always: boolean): Promise<void> {
  const t = schema.foodStaples;
  const key = item.trim().toLowerCase();
  if (always) {
    await tx.insert(t).values({ tenantId, item: key }).onConflictDoNothing();
  } else {
    await tx.delete(t).where(and(eq(t.tenantId, tenantId), eq(t.item, key)));
  }
}

/**
 * Name the lines the list's days ask for that are not named yet: this week and
 * the next, so a list opened later is sorted already. One call to Claude for
 * up to LINES_PER_READ lines, outside any transaction (a call takes seconds),
 * with the names the space already uses; what comes back is kept, a line
 * named twice at once kept once. Lines left unanswered stay unnamed, to be
 * asked again. How many were named, and how many are still not.
 */
export async function nameLines(
  ctx: TenantContext,
  deps: { model?: NamesModel; now?: Date } = {},
): Promise<{ named: number; left: number }> {
  const { from, to } = plannable(todayInTimezone(ctx.tenant.timezone, deps.now ?? new Date()));
  const { unnamed, known } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const plan = await shoppingPlan(tx, ctx.tenant.id, from, to);
      const lines = listLines(plan.cooks, plan.foods);
      const named = await lineNames(tx, ctx.tenant.id, lines);
      return { unnamed: lines.filter((line) => !(line in named)), known: await knownItems(tx, ctx.tenant.id) };
    },
    { role: ctx.role },
  );
  if (unnamed.length === 0) return { named: 0, left: 0 };

  const batch = unnamed.slice(0, LINES_PER_READ);
  let raw: unknown;
  try {
    raw = await (deps.model ?? callNamesModel)(namesPrompt(batch, known));
  } catch (error) {
    console.error("list naming failed", error instanceof Error ? error.name : "unknown");
    throw new FoodError("LIST_FAILED");
  }
  const names = normalizeNames(raw, batch);
  const rows = Object.entries(names).flatMap(([line, list]) =>
    list.map((name) => ({ tenantId: ctx.tenant.id, line, item: name.item, aisle: name.aisle, staple: name.staple })),
  );
  if (rows.length > 0) {
    await withTenant(
      ctx.tenant.id,
      (tx) => tx.insert(schema.foodLineNames).values(rows).onConflictDoNothing(),
      { role: ctx.role },
    );
  }
  const named = Object.keys(names).length;
  return { named, left: unnamed.length - named };
}
