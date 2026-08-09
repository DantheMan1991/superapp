"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { withWork, type WorkCtx } from "@/lib/work/with-work";
import { WORK_STATES, WORK_VISIBILITIES } from "@/lib/work/vocabulary";
import { WORK_COLORS } from "./core/colors";
import { WorkError, friendlyMessage } from "./core/errors";
import { createList, setListArchived, updateList } from "./list-ops";
import {
  createItem,
  setAssignee,
  setItemState,
  setParent,
  updateItem,
} from "./item-ops";

/**
 * Server actions for Work. Canonical shape (conventions §1):
 * gate → Zod → withWork (work + audit in one transaction) → revalidate.
 *
 * THIS FILE EXPORTS ONLY ASYNC FUNCTIONS. Schemas, colours and error codes live
 * in `core/`, because a `"use server"` file that exports anything else throws
 * when the action graph is evaluated — which no test, type check or build
 * catches. See `core/colors.ts` for the production incident.
 *
 * Every call goes through `withWork` rather than `withTenant`: the list
 * policies read `app_current_tenant_role()`, and the wrapper is what makes
 * forgetting the role impossible rather than a habit.
 */

const BASE = "/dashboard/m/work";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<WorkCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "work");
  // Fail closed for the accountant role, as CRM, Documents and Scheduling do.
  // There is no read-only-safe write in this module — and `listAssignableMembers`
  // already refuses to offer an expert as an assignee, so the loop is closed at
  // both ends rather than half-open.
  if (ctx.role === "expert") {
    throw new WorkError("FORBIDDEN", "accountant access is read-only");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(error: unknown): { error: string } {
  if (error instanceof WorkError) return { error: friendlyMessage(error) };
  console.error("work action failed", error);
  return { error: "Something went wrong." };
}

function revalidate(): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/lists`);
}

const nameSchema = z.string().trim().min(1).max(80);
const titleSchema = z.string().trim().min(1).max(200);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd")
  .nullable();

const createListSchema = z.object({
  name: nameSchema,
  color: z.enum(WORK_COLORS),
  visibility: z.enum(WORK_VISIBILITIES),
});

export async function createListAction(
  input: unknown,
): Promise<ActionResult<{ listId: string }>> {
  try {
    const ctx = await gate();
    const parsed = createListSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const listId = await withWork(ctx, async (tx) => {
      const id = await createList(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "work.list_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "work_list",
        targetId: id,
        meta: { visibility: parsed.data.visibility },
      });
      return id;
    });
    revalidate();
    return { ok: true, data: { listId } };
  } catch (error) {
    return fail(error);
  }
}

const updateListSchema = z.object({
  listId: z.string().uuid(),
  name: nameSchema.optional(),
  color: z.enum(WORK_COLORS).optional(),
  visibility: z.enum(WORK_VISIBILITIES).optional(),
});

export async function updateListAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = updateListSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { listId, ...patch } = parsed.data;

    await withWork(ctx, async (tx) => {
      await updateList(tx, ctx, listId, patch);
      // Only a visibility change is audited: renames and colours are not
      // security-relevant, and an audit log that records every keystroke is one
      // nobody reads when it matters.
      if (patch.visibility) {
        await logAuditInTx(tx, {
          action: "work.list_visibility_changed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "work_list",
          targetId: listId,
          meta: { visibility: patch.visibility },
        });
      }
    });
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const archiveListSchema = z.object({
  listId: z.string().uuid(),
  archived: z.boolean(),
});

export async function setListArchivedAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = archiveListSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withWork(ctx, (tx) =>
      setListArchived(tx, ctx, parsed.data.listId, parsed.data.archived),
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const createItemSchema = z.object({
  listId: z.string().uuid(),
  title: titleSchema,
  description: z.string().max(4000).optional(),
  dueOn: dateSchema.optional(),
  startsOn: dateSchema.optional(),
  assignee: z.string().min(1).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export async function createItemAction(
  input: unknown,
): Promise<ActionResult<{ itemId: string }>> {
  try {
    const ctx = await gate();
    const parsed = createItemSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const itemId = await withWork(ctx, (tx) =>
      createItem(tx, ctx, parsed.data),
    );
    revalidate();
    return { ok: true, data: { itemId } };
  } catch (error) {
    return fail(error);
  }
}

const updateItemSchema = z.object({
  itemId: z.string().uuid(),
  title: titleSchema.optional(),
  description: z.string().max(4000).optional(),
  dueOn: dateSchema.optional(),
  startsOn: dateSchema.optional(),
  listId: z.string().uuid().optional(),
  status: z.string().trim().max(40).optional(),
});

export async function updateItemAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = updateItemSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { itemId, ...patch } = parsed.data;

    await withWork(ctx, (tx) => updateItem(tx, ctx, itemId, patch));
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const assignSchema = z.object({
  itemId: z.string().uuid(),
  assignee: z.string().min(1).nullable(),
});

export async function setAssigneeAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = assignSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withWork(ctx, (tx) =>
      setAssignee(tx, ctx, parsed.data.itemId, parsed.data.assignee),
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const stateSchema = z.object({
  itemId: z.string().uuid(),
  state: z.enum(WORK_STATES),
});

export async function setItemStateAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = stateSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withWork(ctx, (tx) =>
      setItemState(tx, ctx, parsed.data.itemId, parsed.data.state),
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const parentSchema = z.object({
  itemId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
});

export async function setParentAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = parentSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withWork(ctx, (tx) =>
      setParent(tx, ctx, parsed.data.itemId, parsed.data.parentId),
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
