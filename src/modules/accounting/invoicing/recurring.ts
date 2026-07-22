import "server-only";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant, type Tx } from "@/db";
import type { RecurringInvoice } from "@/db/schema";
import { LedgerError, getSettings, requireOwnerRole, type LedgerCtx } from "../core";
import { addDaysIso } from "../lib/dates";
import { todayInTimezone } from "../lib/money";
import { invoiceLineSchema, type InvoiceLineInput } from "./lines";
import { createInvoiceDraft } from "./invoices";

/**
 * Recurring invoices (the rent-roll seam). Templates are jsonb —
 * validated at write AND re-validated at generation (accounts/dims may
 * have deactivated since). Generation creates DRAFTS, never auto-issues:
 * a human reviews before AR posts, and generation never touches the
 * ledger (immune to PERIOD_CLOSED).
 */

export const recurringTemplateSchema = z.object({
  lines: z.array(invoiceLineSchema).min(1).max(100),
  memo: z.string().trim().max(2000).optional(),
  dueInDays: z.number().int().min(0).max(365),
});

export type RecurringTemplate = z.infer<typeof recurringTemplateSchema>;

/** Total function because day_of_month is DB-checked to 1–28 (P11). */
export function advanceMonthly(dateIso: string, dayOfMonth: number): string {
  const [y, m] = dateIso.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

const CATCH_UP_CAP = 12;

export async function listRecurringInvoices(
  tx: Tx,
  tenantId: string,
): Promise<RecurringInvoice[]> {
  return tx.query.recurringInvoices.findMany({
    where: eq(schema.recurringInvoices.tenantId, tenantId),
    orderBy: asc(schema.recurringInvoices.name),
  });
}

export async function createRecurringInvoice(
  tx: Tx,
  ctx: LedgerCtx,
  input: {
    customerId: string;
    name: string;
    dayOfMonth: number;
    nextRunDate: string;
    template: RecurringTemplate;
  },
): Promise<RecurringInvoice> {
  requireOwnerRole(ctx);
  const customer = await tx.query.customers.findFirst({
    where: and(
      eq(schema.customers.tenantId, ctx.tenantId),
      eq(schema.customers.id, input.customerId),
    ),
  });
  if (!customer || !customer.isActive) {
    throw new LedgerError("CUSTOMER_NOT_FOUND", "customer invalid");
  }
  await assertTemplateReferences(tx, ctx.tenantId, input.template);
  const [row] = await tx
    .insert(schema.recurringInvoices)
    .values({
      tenantId: ctx.tenantId,
      customerId: input.customerId,
      name: input.name,
      template: input.template,
      dayOfMonth: input.dayOfMonth,
      nextRunDate: input.nextRunDate,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return row;
}

export async function updateRecurringInvoice(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    recurringInvoiceId: string;
    expectedVersion: number;
    patch: {
      name?: string;
      dayOfMonth?: number;
      nextRunDate?: string;
      template?: RecurringTemplate;
    };
  },
): Promise<RecurringInvoice> {
  requireOwnerRole(ctx);
  if (args.patch.template) {
    await assertTemplateReferences(tx, ctx.tenantId, args.patch.template);
  }
  const rows = await tx
    .update(schema.recurringInvoices)
    .set({
      ...(args.patch.name !== undefined ? { name: args.patch.name } : {}),
      ...(args.patch.dayOfMonth !== undefined
        ? { dayOfMonth: args.patch.dayOfMonth }
        : {}),
      ...(args.patch.nextRunDate !== undefined
        ? { nextRunDate: args.patch.nextRunDate }
        : {}),
      ...(args.patch.template !== undefined ? { template: args.patch.template } : {}),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.recurringInvoices.tenantId, ctx.tenantId),
        eq(schema.recurringInvoices.id, args.recurringInvoiceId),
        eq(schema.recurringInvoices.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "template changed since loaded");
  }
  return rows[0];
}

export async function setRecurringActive(
  tx: Tx,
  ctx: LedgerCtx,
  args: { recurringInvoiceId: string; expectedVersion: number; active: boolean },
): Promise<RecurringInvoice> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.recurringInvoices)
    .set({ isActive: args.active, version: args.expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.recurringInvoices.tenantId, ctx.tenantId),
        eq(schema.recurringInvoices.id, args.recurringInvoiceId),
        eq(schema.recurringInvoices.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "template changed since loaded");
  }
  return rows[0];
}

/** Re-validate jsonb references (no FK protection on templates). */
async function assertTemplateReferences(
  tx: Tx,
  tenantId: string,
  template: RecurringTemplate,
): Promise<void> {
  const accountIds = [...new Set(template.lines.map((l) => l.incomeAccountId))];
  const accounts = await tx.query.accounts.findMany({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      inArray(schema.accounts.id, accountIds),
    ),
  });
  for (const id of accountIds) {
    const a = accounts.find((x) => x.id === id);
    if (!a || !a.isActive) {
      throw new LedgerError("RECURRING_TEMPLATE_INVALID", `account ${id} invalid`);
    }
  }
  const memberIds = [
    ...new Set(template.lines.flatMap((l) => l.dimensionMemberIds ?? [])),
  ];
  if (memberIds.length > 0) {
    const members = await tx.query.dimensionMembers.findMany({
      where: and(
        eq(schema.dimensionMembers.tenantId, tenantId),
        inArray(schema.dimensionMembers.id, memberIds),
      ),
    });
    for (const id of memberIds) {
      const m = members.find((x) => x.id === id);
      if (!m || !m.isActive) {
        throw new LedgerError("RECURRING_TEMPLATE_INVALID", `member ${id} invalid`);
      }
    }
  }
}

export interface GenerationResult {
  created: number;
  templatesRun: number;
  errors: Array<{ recurringInvoiceId: string; name: string; error: string }>;
}

/**
 * One transaction PER TEMPLATE (a bad template never rolls back the
 * others); per-template CAS on version guards double-clicks. Catch-up
 * creates one period-dated draft per missed period, capped at 12.
 */
export async function generateRecurringInvoices(
  ctx: LedgerCtx,
): Promise<GenerationResult> {
  requireOwnerRole(ctx);
  const { due, today } = await withTenant(ctx.tenantId, async (tx) => {
    const settings = await getSettings(tx, ctx.tenantId);
    const today = todayInTimezone(settings.bookkeepingTimezone);
    const due = await tx.query.recurringInvoices.findMany({
      where: and(
        eq(schema.recurringInvoices.tenantId, ctx.tenantId),
        eq(schema.recurringInvoices.isActive, true),
        lte(schema.recurringInvoices.nextRunDate, today),
      ),
    });
    return { due, today };
  });

  const result: GenerationResult = { created: 0, templatesRun: 0, errors: [] };
  for (const template of due) {
    try {
      const created = await withTenant(ctx.tenantId, async (tx) => {
        const parsed = recurringTemplateSchema.safeParse(template.template);
        if (!parsed.success) {
          throw new LedgerError("RECURRING_TEMPLATE_INVALID", "template shape invalid");
        }
        await assertTemplateReferences(tx, ctx.tenantId, parsed.data);
        let next = template.nextRunDate;
        let runs = 0;
        while (next <= today && runs < CATCH_UP_CAP) {
          await createInvoiceDraft(tx, ctx, {
            customerId: template.customerId,
            issueDate: next,
            dueDate: addDaysIso(next, parsed.data.dueInDays),
            memo: parsed.data.memo,
            lines: parsed.data.lines as InvoiceLineInput[],
            recurringInvoiceId: template.id,
          });
          next = advanceMonthly(next, template.dayOfMonth);
          runs += 1;
        }
        const rows = await tx
          .update(schema.recurringInvoices)
          .set({
            nextRunDate: next,
            lastGeneratedAt: new Date(),
            version: template.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.recurringInvoices.tenantId, ctx.tenantId),
              eq(schema.recurringInvoices.id, template.id),
              eq(schema.recurringInvoices.version, template.version),
            ),
          )
          .returning();
        if (rows.length === 0) {
          // Someone else generated concurrently — roll this template back.
          throw new LedgerError("STALE_VERSION", "template generated concurrently");
        }
        return runs;
      });
      result.created += created;
      result.templatesRun += 1;
    } catch (err) {
      result.errors.push({
        recurringInvoiceId: template.id,
        name: template.name,
        error:
          err instanceof LedgerError ? err.code : "unexpected error",
      });
    }
  }
  return result;
}
