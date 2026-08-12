"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import {
  LedgerError,
  friendlyMessage,
  requireOwnerRole,
  type LedgerCtx,
} from "../core";
import { isValidIsoDate } from "../lib/money";
import {
  journalTemplateBalances,
  recurringEntryTemplateSchema,
} from "./template";
import { generateRecurringEntries } from "./generate";

/**
 * Owner actions for recurring journals and bills.
 *
 * Separate from `invoicing/actions.ts` because this is a separate table with a
 * separate lifecycle — and because the invoicing file is already long enough
 * that adding a third recurrence surface to it would make both harder to read.
 */

const BASE = "/dashboard/m/accounting";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<LedgerCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  if (ctx.role === "expert") {
    throw new LedgerError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (!(err instanceof LedgerError)) console.error("recurring action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidateRecurring(): void {
  revalidatePath(`${BASE}/recurring`);
  revalidatePath(`${BASE}/journal`);
  revalidatePath(`${BASE}/purchases/bills`);
  revalidatePath(`${BASE}/trial-balance`);
}

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    vendorId: z.string().uuid().nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(28),
    nextRunDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isValidIsoDate, "Not a real calendar date"),
    autoPost: z.boolean().optional(),
    template: recurringEntryTemplateSchema,
  })
  // The two shape rules the database also carries, checked here so the message
  // is a sentence rather than a constraint-violation string.
  .refine(
    (v) => (v.template.kind === "bill" ? !!v.vendorId : !v.vendorId),
    "A bill needs a supplier; a journal must not have one",
  )
  .refine(
    (v) => !v.autoPost || v.template.kind === "journal",
    "Only a journal can post automatically",
  )
  .refine(
    (v) =>
      v.template.kind !== "journal" || journalTemplateBalances(v.template.lines),
    "The journal's debits and credits must be equal",
  );

export async function createRecurringEntryAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await gate();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    requireOwnerRole(ctx);
    const row = await withTenant(ctx.tenantId, async (tx) => {
      const [created] = await tx
        .insert(schema.recurringEntries)
        .values({
          tenantId: ctx.tenantId,
          kind: parsed.data.template.kind,
          name: parsed.data.name,
          vendorId: parsed.data.vendorId ?? null,
          template: parsed.data.template,
          dayOfMonth: parsed.data.dayOfMonth,
          nextRunDate: parsed.data.nextRunDate,
          autoPost: parsed.data.autoPost === true,
          createdByClerkUserId: ctx.userId,
        })
        .returning();
      await logAuditInTx(tx, {
        action: "ledger.recurring_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "recurring_entry",
        targetId: created.id,
        // Whether it posts by itself is the fact worth being able to look up.
        meta: { kind: created.kind, autoPost: created.autoPost },
      });
      return created;
    });
    revalidateRecurring();
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return fail(err);
  }
}

const setActiveSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  active: z.boolean(),
});

export async function setRecurringEntryActiveAction(
  input: z.infer<typeof setActiveSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    requireOwnerRole(ctx);
    await withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx
        .update(schema.recurringEntries)
        .set({
          isActive: parsed.data.active,
          version: parsed.data.expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.recurringEntries.tenantId, ctx.tenantId),
            eq(schema.recurringEntries.id, parsed.data.id),
            eq(schema.recurringEntries.version, parsed.data.expectedVersion),
          ),
        )
        .returning({ id: schema.recurringEntries.id });
      if (rows.length === 0) {
        throw new LedgerError("STALE_VERSION", "template changed since loaded");
      }
    });
    revalidateRecurring();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function generateRecurringEntriesAction(): Promise<
  ActionResult<{
    created: number;
    posted: number;
    deferredToDraft: number;
    errors: number;
  }>
> {
  const ctx = await gate();
  try {
    const result = await generateRecurringEntries(ctx);
    revalidateRecurring();
    return {
      ok: true,
      data: {
        created: result.created,
        posted: result.posted,
        deferredToDraft: result.deferredToDraft,
        errors: result.errors.length,
      },
    };
  } catch (err) {
    return fail(err);
  }
}
