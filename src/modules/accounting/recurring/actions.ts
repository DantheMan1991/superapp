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
  type RecurringEntryTemplate,
} from "./template";
import {
  createRecurringEntry,
  generateRecurringEntries,
  updateRecurringEntry,
} from "./generate";

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
  revalidatePath(`${BASE}/sales/invoices`);
  revalidatePath(`${BASE}/trial-balance`);
}

const templateFields = z.object({
  name: z.string().trim().min(1).max(200),
  vendorId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(28),
  nextRunDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidIsoDate, "Not a real calendar date"),
  autoPost: z.boolean().optional(),
  template: recurringEntryTemplateSchema,
});

/** What the four shape rules read. Create and update both satisfy it. */
interface ShapeInput {
  vendorId?: string | null;
  customerId?: string | null;
  autoPost?: boolean;
  template: RecurringEntryTemplate;
}

/**
 * The shape rules the database also carries (`recurring_entries_party_shape`,
 * `recurring_entries_auto_post_shape`), checked here so the message is a
 * sentence rather than a constraint-violation string.
 *
 * ONE list applied to both schemas. A refined schema cannot be `.extend`ed, so
 * the day an update schema arrived the choice was to copy four refines or to
 * name them once — and a copied rule is one that drifts.
 */
const SHAPE_RULES: ReadonlyArray<[(v: ShapeInput) => boolean, string]> = [
  [
    (v) => (v.template.kind === "bill" ? !!v.vendorId : !v.vendorId),
    "A bill needs a supplier; nothing else may have one",
  ],
  [
    (v) => (v.template.kind === "invoice" ? !!v.customerId : !v.customerId),
    "An invoice needs a customer; nothing else may have one",
  ],
  [
    (v) => !v.autoPost || v.template.kind === "journal",
    "Only a journal can post automatically",
  ],
  [
    (v) =>
      v.template.kind !== "journal" || journalTemplateBalances(v.template.lines),
    "The journal's debits and credits must be equal",
  ],
];

const shapeRules = (v: ShapeInput, ctx: z.RefinementCtx) => {
  for (const [ok, message] of SHAPE_RULES) {
    if (!ok(v)) ctx.addIssue({ code: "custom", message });
  }
};

const createSchema = templateFields.superRefine(shapeRules);

const updateSchema = templateFields
  .extend({
    id: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
  })
  .superRefine(shapeRules);

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
      // The account check lives in the op, where a test can reach it.
      const created = await createRecurringEntry(tx, ctx, parsed.data);
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

/**
 * A snapshot the audit row can carry. The template jsonb is overwritten in
 * place with no history table, so this is the only before-state that will
 * ever exist — the `ledger.entry_edited` shape, and S9's "moved from and to".
 * Template cents are an instruction, not a balance.
 */
const auditSnapshot = (row: {
  name: string;
  dayOfMonth: number;
  nextRunDate: string;
  autoPost: boolean;
  vendorId: string | null;
  customerId: string | null;
  template: unknown;
}) => ({
  name: row.name,
  dayOfMonth: row.dayOfMonth,
  nextRunDate: row.nextRunDate,
  autoPost: row.autoPost,
  vendorId: row.vendorId,
  customerId: row.customerId,
  template: row.template,
});

export async function updateRecurringEntryAction(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    requireOwnerRole(ctx);
    await withTenant(ctx.tenantId, async (tx) => {
      const { before, after } = await updateRecurringEntry(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "ledger.recurring_updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "recurring_entry",
        targetId: after.id,
        // `kind` and `autoPost` stay top-level so the `recurring_created`
        // lookup shape holds; the before/after is what an edit is.
        meta: {
          kind: after.kind,
          autoPost: after.autoPost,
          before: auditSnapshot(before),
          after: auditSnapshot(after),
        },
      });
    });
    revalidateRecurring();
    return { ok: true };
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
    /**
     * Periods walked. Returned for ONE reason — the button's "nothing was due"
     * test — and never rendered. See the toast for why `created` can no longer
     * answer that.
     */
    periodsWalked: number;
    posted: number;
    deferredToDraft: number;
    tagsDropped: number;
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
        periodsWalked: result.periodsWalked,
        posted: result.posted,
        deferredToDraft: result.deferredToDraft,
        tagsDropped: result.tagsDropped,
        errors: result.errors.length,
      },
    };
  } catch (err) {
    return fail(err);
  }
}
