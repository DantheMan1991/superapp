"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withWork } from "@/lib/work/with-work";
import { requireTenant } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { WorkError } from "@/lib/work/errors";
import {
  createWorkForEntity,
  setWorkAssignee,
  updateEntityWork,
} from "@/lib/work/entity-work";
import { setItemState, updateItem } from "@/lib/work/items";

/**
 * WORK, RAISED AND WORKED WHERE IT LIVES — the Layer 0 action surface.
 *
 * The data seam for cross-module work has existed since CRM slice 5b
 * (`entity-work.ts`, `items.ts`). What did not exist was ACTIONS, and the
 * consequence was structural rather than cosmetic: the only `"use server"` file
 * was `src/modules/work/actions.ts`, a module may not import another module, so
 * every consumer wrapped its own subset. CRM wrapped two verbs — reopen and
 * delete — which is why a follow-up on a CRM record reads as a stub you have to
 * leave CRM to actually work. Assets would have wrapped a different two, and
 * the product would have grown a third inconsistent work surface.
 *
 * These live at Layer 0 so every module and every pack calls the SAME verbs.
 * See docs/extension-model.md — a pack never builds its own task engine, and
 * never sends somebody to Work to act on what it raised.
 *
 * THE GUARD IS THE OWNING FEATURE, NOT WORK. `extensionSlug` says which module
 * or pack the record belongs to, and that is what must be switched on: a
 * follow-up on a CRM record is CRM's business. Work being off does not stop it
 * — the item simply has no second home to appear in, which is the same thing
 * that happens today.
 */

const entityRef = z.object({
  extensionSlug: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/),
  entityType: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  entityId: z.string().uuid(),
});

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

/**
 * Shared failure shape, so every caller renders errors the same way.
 *
 * The wording lives HERE rather than being imported from Work's own
 * `friendlyMessage`: that function sits in `src/modules/work/core/errors.ts`,
 * and `src/lib/` may not depend on a module. Its own header anticipates this —
 * turning a code into a sentence is presentation, and each surface may want its
 * own words. These are the words for an inline panel, where the reader is in
 * the middle of something else.
 */
function toResult(err: unknown): { error: string } {
  if (err instanceof WorkError) {
    switch (err.code) {
      case "NOT_FOUND":
        return { error: "That work no longer exists." };
      case "FORBIDDEN":
        return { error: "You cannot change that one." };
      case "NOT_ASSIGNABLE":
        return { error: "That person cannot be given work here." };
      case "STALE":
        return {
          error: "Somebody else changed this. Refresh and try again.",
        };
      case "DEFAULT_IS_PERMANENT":
      case "WOULD_CYCLE":
      case "INVALID":
        return { error: "That change is not allowed." };
    }
  }
  console.error("work action failed", err);
  return { error: "Something went wrong with that." };
}

/**
 * Refuse work on a record whose feature is switched off.
 *
 * Returns a message rather than 404ing: these run from inline panels, and a
 * thrown `notFound()` inside a dialog would blank the page somebody was
 * working on.
 */
async function assertFeatureOn(
  tenantId: string,
  extensionSlug: string,
): Promise<string | null> {
  const on = await isModuleEnabled(tenantId, extensionSlug);
  return on ? null : "That part of the product is not switched on.";
}

const addSchema = entityRef.extend({
  title: z.string().min(1).max(500),
  notes: z.string().max(5000).optional(),
  dueOn: optionalDate,
  assignee: z.string().max(200).nullable().optional(),
  /** The surface to refresh afterwards; the caller knows, this file does not. */
  revalidate: z.string().max(500).optional(),
});

export async function addEntityWorkAction(input: unknown) {
  const ctx = await requireTenant();
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { error: "Give it a name." };
  const { extensionSlug, entityType, entityId, revalidate, ...work } =
    parsed.data;

  const blocked = await assertFeatureOn(ctx.tenant.id, extensionSlug);
  if (blocked) return { error: blocked };

  try {
    const itemId = await withWork(
      { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role },
      (tx) =>
        createWorkForEntity(
          tx,
          { tenantId: ctx.tenant.id, userId: ctx.userId },
          { extensionSlug, entityType, entityId },
          {
            title: work.title.trim(),
            notes: work.notes ?? "",
            dueOn: work.dueOn ?? null,
            assignee: work.assignee ?? null,
          },
        ),
    );
    await logAudit({
      action: "work.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "work_item",
      targetId: itemId,
      meta: { extensionSlug, entityType },
    });
    if (revalidate) revalidatePath(revalidate);
    return { ok: true, id: itemId };
  } catch (err) {
    return toResult(err);
  }
}

const stateSchema = z.object({
  itemId: z.string().uuid(),
  done: z.boolean(),
  /**
   * Opt-in optimistic concurrency, and NOT optional in spirit.
   *
   * Follow-ups have carried a `version` since CRM slice 1, and `errors.ts`
   * records that slice 5b kept it deliberately — migrating without it "would
   * quietly drop a property follow-ups have today". A shared verb that ignored
   * it would do exactly that, one layer down. Callers rendering a version pass
   * it; a rule or an import that has nothing to be stale about omits it, which
   * is last-write-wins and is what those callers always had.
   */
  expectedVersion: z.number().int().nonnegative().optional(),
  revalidate: z.string().max(500).optional(),
});

export async function setEntityWorkDoneAction(input: unknown) {
  const ctx = await requireTenant();
  const parsed = stateSchema.safeParse(input);
  if (!parsed.success) return { error: "Could not update that." };

  try {
    await withWork(
      { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role },
      (tx) =>
        withVersionGuard(tx, ctx, parsed.data).then(() =>
          setItemState(
            tx,
            { tenantId: ctx.tenant.id, userId: ctx.userId },
          parsed.data.itemId,
          // `todo`, not `open` — WORK_STATES is todo/in_progress/blocked/
          // done/cancelled, and reopening returns an item to the start of the
          // board rather than to a state that does not exist.
            parsed.data.done ? "done" : "todo",
          ),
        ),
    );
    if (parsed.data.revalidate) revalidatePath(parsed.data.revalidate);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Enforce the caller's version before a state change, the way CRM does it: an
 * EMPTY patch through `updateEntityWork`, whose only job is to fail when the
 * row moved. `setItemState` takes no version of its own, so this is the seam
 * that carries the guarantee.
 */
async function withVersionGuard(
  tx: Parameters<Parameters<typeof withWork>[1]>[0],
  ctx: { tenant: { id: string }; userId: string },
  data: { itemId: string; expectedVersion?: number },
): Promise<void> {
  if (data.expectedVersion === undefined) return;
  await updateEntityWork(
    tx,
    { tenantId: ctx.tenant.id, userId: ctx.userId },
    data.itemId,
    data.expectedVersion,
    {},
  );
}

const assigneeSchema = z.object({
  itemId: z.string().uuid(),
  assignee: z.string().max(200).nullable(),
  revalidate: z.string().max(500).optional(),
});

export async function setEntityWorkAssigneeAction(input: unknown) {
  const ctx = await requireTenant();
  const parsed = assigneeSchema.safeParse(input);
  if (!parsed.success) return { error: "Could not reassign that." };

  try {
    await withWork(
      { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role },
      (tx) =>
        setWorkAssignee(
          tx,
          { tenantId: ctx.tenant.id, userId: ctx.userId },
          parsed.data.itemId,
          parsed.data.assignee,
        ),
    );
    if (parsed.data.revalidate) revalidatePath(parsed.data.revalidate);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

const dueSchema = z.object({
  itemId: z.string().uuid(),
  dueOn: optionalDate,
  expectedVersion: z.number().int().nonnegative().optional(),
  revalidate: z.string().max(500).optional(),
});

export async function setEntityWorkDueAction(input: unknown) {
  const ctx = await requireTenant();
  const parsed = dueSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick a date." };

  try {
    await withWork(
      { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role },
      (tx) =>
        updateItem(
          tx,
          { tenantId: ctx.tenant.id, userId: ctx.userId },
          parsed.data.itemId,
          { dueOn: parsed.data.dueOn ?? null },
          parsed.data.expectedVersion,
        ),
    );
    if (parsed.data.revalidate) revalidatePath(parsed.data.revalidate);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}
