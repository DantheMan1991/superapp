"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withWork } from "@/lib/work/with-work";
import { withTenant } from "@/db";
import { requireTenant, type TenantRole } from "@/lib/auth";
import { isModuleEnabled, moduleCategory } from "@/lib/modules";
import { ownerFeatureAllowsWrite } from "@/lib/packs/authorize";
import { logAudit } from "@/lib/audit";
import { WorkError } from "@/lib/work/errors";
import {
  createWorkForEntity,
  owningFeatures,
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

/**
 * **WHOSE ROLE RULE APPLIES, AND THE ANSWER IS THE OWNING FEATURE'S.**
 *
 * The header above says the guard is the owning feature. That was true of
 * whether the feature is switched ON and was never true of the ROLE: these verbs
 * asked no role question at all, so an accountant could tick off, hand over and
 * re-date a CRM follow-up, in a module where every other write refuses them.
 * `docs/help/crm/tasks.md` documented it as the one part of CRM that was not
 * read-only. Fixed 2026-09-04.
 *
 * The two kinds of owner disagree on purpose — a core module refuses `expert`,
 * a capability pack admits one at `member` level — so this asks the DATABASE
 * which kind each owner is (`modules.category`) rather than picking a side. See
 * `ownerFeatureAllowsWrite`.
 *
 * **EVERY OWNER MUST ALLOW IT.** An item linked to a CRM record and to a tractor
 * is refused if either says no. The alternative — any owner is enough — would
 * make attaching a second record a way to widen who may change the first, which
 * is a permission granted by a link.
 *
 * **AND THE WORK MODULE'S OWN RULE IS APPLIED TO AN UNLINKED ITEM.** No links
 * means nobody raised it from a record, which makes it Work's, and Work refuses
 * the accountant. Without this line an empty list would vacuously pass.
 *
 * **THE OTHER HALF OF THE HEADER'S PRINCIPLE — IS THE OWNER SWITCHED ON —
 * IS APPLIED HERE TOO, since 2026-09-04.** `addEntityWorkAction` had always
 * checked it and these three never had, so a follow-up raised on a CRM record
 * stayed workable after CRM was switched off. It is a backstop rather than a
 * visible change: every surface that renders `WorkItemRow` — the CRM record
 * timeline, CRM's follow-up list, the asset maintenance panel — already sits
 * behind `requireModuleEnabled` for the same feature that owns the item, so a
 * reader whose module is off cannot reach the control. What this closes is the
 * stale tab and the direct call.
 *
 * Both checks read one row set, and the ENABLED one is reported first: "not
 * switched on" is the more useful answer when both are true, and it is the one
 * an owner can act on.
 */
async function assertOwnersAllowWrite(
  tenantId: string,
  role: TenantRole,
  itemId: string,
): Promise<string | null> {
  const owners = await withTenant(tenantId, (tx) =>
    owningFeatures(tx, tenantId, itemId),
  );
  if (owners.some((o) => !o.enabled)) {
    return "That part of the product is not switched on.";
  }
  /*
   * An unlinked item is the Work module's own, so it gets a core owner's rule
   * rather than passing vacuously. It needs no ENABLED check to match: Work
   * being off does not orphan an item that was never raised from a record —
   * see this file's header on what Work being off does and does not mean.
   */
  const categories =
    owners.length === 0 ? ["core"] : owners.map((o) => o.category ?? "core");
  const allowed = categories.every((c) => ownerFeatureAllowsWrite(c, role));
  return allowed ? null : "You do not have access to do that.";
}

export async function addEntityWorkAction(input: unknown) {
  const ctx = await requireTenant();
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { error: "Give it a name." };
  const { extensionSlug, entityType, entityId, revalidate, ...work } =
    parsed.data;

  const blocked = await assertFeatureOn(ctx.tenant.id, extensionSlug);
  if (blocked) return { error: blocked };

  /*
   * The same rule as the three verbs below, asked the cheap way: this action is
   * TOLD which feature owns the record, so there is nothing to look up. Raising
   * a follow-up on a CRM record was open to the accountant for the same reason
   * ticking one off was.
   */
  const category = await moduleCategory(ctx.tenant.id, extensionSlug);
  if (!ownerFeatureAllowsWrite(category ?? "core", ctx.role)) {
    return { error: "You do not have access to do that." };
  }

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

  const refused = await assertOwnersAllowWrite(
    ctx.tenant.id,
    ctx.role,
    parsed.data.itemId,
  );
  if (refused) return { error: refused };

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

  const refused = await assertOwnersAllowWrite(
    ctx.tenant.id,
    ctx.role,
    parsed.data.itemId,
  );
  if (refused) return { error: refused };

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

  const refused = await assertOwnersAllowWrite(
    ctx.tenant.id,
    ctx.role,
    parsed.data.itemId,
  );
  if (refused) return { error: refused };

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
