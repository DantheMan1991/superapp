"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getActiveModules } from "@/lib/modules";
import { getFeature, getRenderableFeature } from "@/lib/features";
import { allowedKeys, starterById } from "@/lib/access/starters";
import {
  AccessError,
  createAccessLevel,
  deleteAccessLevel,
  setMemberAccess,
  updateAccessLevel,
} from "@/lib/access/levels";

/**
 * The access list's write surface (ADR 0093).
 *
 * **OWNER-ONLY AT THE DOOR AND AGAIN IN POSTGRES.** `requireTenantOwner()`
 * gives the person a redirect instead of a failed transaction; the policies in
 * `drizzle/0385` are what make it true. Both halves matter and neither is
 * decoration: an access level is a capability, and the one thing a capability
 * table must not be is writable by the people it restricts.
 *
 * **`{ role: ctx.role }` ON EVERY `withTenant` HERE.** Without it the option
 * defaults to `staff` — the least privileged value, by design (security.md S3)
 * — and every write on this page would be refused. The value comes from
 * `requireTenantOwner()` and nowhere else.
 *
 * Not `requireModuleEnabled`: an access level is Layer 0, like a membership.
 * Gating it on any module would hide the permission screen from a workspace
 * that had switched that module off.
 */

const BASE = "/dashboard/settings/access";

/**
 * A key is a module slug or `module:area`. Shape only, not an enum — the
 * registry changes with a deploy, and a key nothing answers to is ignored by
 * `reaches` rather than refused here. Refusing would mean a level became
 * un-editable the day a module was retired.
 */
const keySchema = z.string().trim().max(96).regex(/^[a-z0-9-]+(:[a-z0-9-]+)?$/);

const levelSchema = z.object({
  name: z.string().trim().min(1).max(60),
  notes: z.string().trim().max(2000).optional(),
  denied: z.array(keySchema).max(200).optional(),
});

function toResult(err: unknown): { error: string } {
  if (err instanceof AccessError) return { error: err.message };
  console.error("access level action failed", err);
  return { error: "Something went wrong saving that." };
}

export async function createAccessLevelAction(input: unknown) {
  const ctx = await requireTenantOwner();
  const parsed = levelSchema.safeParse(input);
  if (!parsed.success) return { error: "Give the level a name, up to 60 characters." };
  try {
    const level = await withTenant(
      ctx.tenant.id,
      (tx) => createAccessLevel(tx, ctx.tenant.id, parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "access.level_created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "access_level",
      targetId: level.id,
      // The keys, not the notes: what a level takes away is the fact worth
      // being able to reconstruct later, and it is not personal data.
      meta: { name: level.name, denied: level.denied },
    });
    revalidatePath(BASE);
    return { ok: true as const, id: level.id };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Create a level from a starter (ADR 0097).
 *
 * **THE DENIED LIST IS COMPUTED HERE, ON THE SERVER, FROM WHAT THIS BUSINESS
 * ACTUALLY HAS.** A starter names keys that might exist — one list serves a
 * farm and a builder — so the level it produces is *everything on offer today,
 * minus what the starter allows*. Computing it on the client would bake in
 * whatever that page happened to know, and a stale tab would write a level
 * missing a tool switched on five minutes ago.
 *
 * What it creates is an ORDINARY level. Nothing marks it as having come from a
 * starter, nothing reasserts it, and the owner can rename, retick or delete it
 * like any other. After this call there is nothing left of the starter but a
 * name.
 */
export async function createStarterLevelAction(input: unknown) {
  const ctx = await requireTenantOwner();
  const parsed = z.object({ starterId: z.string().max(40) }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const starter = starterById(parsed.data.starterId);
  if (!starter) return { error: "That starter no longer exists." };

  const onOffer = (await getActiveModules(ctx.tenant.id))
    .filter(({ module }) => getRenderableFeature(module.id))
    .flatMap(({ module }) => [
      module.id,
      ...(getFeature(module.id)?.areas ?? []).map((a) => `${module.id}:${a.key}`),
    ]);
  /**
   * **NAMING A TOOL ALLOWS ITS PARTS TOO**, and this line is here because the
   * first version did not. `allowedKeys` is pure and cannot expand a tool into
   * its areas — it has no registry — so a starter saying `tools: ["documents"]`
   * produced a level with Documents ticked and all seven of its parts unticked:
   * a tool whose only page was its front door. The tests passed (the tool WAS
   * allowed) and the screen said "Documents (some)", which is how it was found.
   */
  const whole = new Set(starter.tools);
  const allowed = new Set(allowedKeys(starter));
  const denied = onOffer.filter(
    (key) => !allowed.has(key) && !whole.has(key.split(":")[0]),
  );

  try {
    const level = await withTenant(
      ctx.tenant.id,
      (tx) =>
        createAccessLevel(tx, ctx.tenant.id, {
          name: starter.name,
          notes: starter.notes,
          denied,
        }),
      { role: ctx.role },
    );
    await logAudit({
      action: "access.level_created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "access_level",
      targetId: level.id,
      meta: { name: level.name, denied: level.denied, starter: starter.id },
    });
    revalidatePath(BASE);
    return { ok: true as const, id: level.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateAccessLevelAction(input: unknown) {
  const ctx = await requireTenantOwner();
  const parsed = levelSchema
    .partial()
    .extend({ id: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { id, ...patch } = parsed.data;
  try {
    const level = await withTenant(
      ctx.tenant.id,
      (tx) => updateAccessLevel(tx, ctx.tenant.id, id, patch),
      { role: ctx.role },
    );
    await logAudit({
      action: "access.level_updated",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "access_level",
      targetId: id,
      meta: { name: level.name, denied: level.denied },
    });
    /**
     * `layout`, and it has to be: this changes what is in the RAIL for everyone
     * on the level, and the rail is rendered by the dashboard layout. Revalidating
     * the page alone would leave them looking at a menu that no longer matches
     * what their pages will serve.
     */
    revalidatePath("/dashboard", "layout");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteAccessLevelAction(input: unknown) {
  const ctx = await requireTenantOwner();
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => deleteAccessLevel(tx, ctx.tenant.id, parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "access.level_deleted",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "access_level",
      targetId: parsed.data.id,
    });
    revalidatePath(BASE);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * What one person may reach: their level, and which companies' books they see.
 *
 * ONE ACTION FOR BOTH, because they are one decision made on one screen, and
 * two writers to a capability row is how a codebase acquires a privilege bug
 * nobody can reproduce. Audited in both directions, and worth it for the reason
 * moving the default company is: this decides what somebody can see for as long
 * as nobody changes it back, and "when did this change, and who changed it" is
 * a question somebody will eventually ask.
 */
export async function setMemberAccessAction(input: unknown) {
  const ctx = await requireTenantOwner();
  const parsed = z
    .object({
      membershipId: z.string().uuid(),
      levelId: z.string().uuid().nullable(),
      /** Empty = every company, which is what every membership reads as today. */
      entityIds: z.array(z.string().uuid()).max(200),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  try {
    await withTenant(
      ctx.tenant.id,
      (tx) =>
        setMemberAccess(tx, ctx.tenant.id, parsed.data.membershipId, {
          levelId: parsed.data.levelId,
          entityIds: parsed.data.entityIds,
        }),
      { role: ctx.role },
    );
    await logAudit({
      action: "access.member_access_set",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "membership",
      targetId: parsed.data.membershipId,
      // Identifiers only, and both of them: which level and how many companies
      // is the pair somebody will want to reconstruct.
      meta: { levelId: parsed.data.levelId, companies: parsed.data.entityIds.length },
    });
    revalidatePath("/dashboard/team");
    revalidatePath(BASE);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}
