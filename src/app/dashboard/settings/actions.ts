"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withSystem } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { logAuditInTx } from "@/lib/audit";
import { isValidTimeZone } from "@/lib/timezone";

const inputSchema = z.object({
  // Validated against the RUNTIME's zone database, not against the picker's
  // list: the list is a UI convenience and a tenant may legitimately already
  // hold a zone outside it. What must never get in is a string the formatter
  // will throw on — that would break every page that asks what day it is.
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(isValidTimeZone, "Not a recognised timezone"),
});

/**
 * Set the business's timezone — the single answer to "what day is it here"
 * for every module, and for the background jobs that have no request behind
 * them.
 *
 * Owner-only. This moves the day boundary for the whole business: it decides
 * which day an invoice is overdue on, which month a journal entry closes into,
 * and which tasks a digest calls due. Staff changing that would be changing
 * the books.
 */
export async function setTenantTimezoneAction(
  input: z.infer<typeof inputSchema>,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireTenantOwner();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid timezone" };
  }
  const { timezone } = parsed.data;
  if (timezone === ctx.tenant.timezone) return { ok: true };

  try {
    /**
     * withSystem, justified (S2): `tenants` is deliberately SELECT-only for
     * tenant context (drizzle/0001) and must stay that way. RLS is row-level,
     * not column-level, so the narrowest member UPDATE policy that could exist
     * here would also expose `status`, `slug` and `clerk_org_id` — letting a
     * tenant flip itself to `active` and skip billing, or repoint its own
     * Clerk binding. That is a far worse trade than this call.
     *
     * The two things S2 actually asks for both hold: authorization happened
     * first (`requireTenantOwner`), and the intent is not user-controlled —
     * the tenant id comes from the session, never from the request body, and
     * the only column written is the one column this action exists to write.
     */
    await withSystem(async (tx) => {
      await tx
        .update(schema.tenants)
        .set({ timezone, updatedAt: new Date() })
        .where(eq(schema.tenants.id, ctx.tenant.id));
      // Worth auditing: this silently re-dates every "today" in the product,
      // so "why did the books close a day early" needs an answer. Zone names
      // are not PII (S9).
      await logAuditInTx(tx, {
        action: "tenant.timezone_set",
        tenantId: ctx.tenant.id,
        actorClerkUserId: ctx.userId,
        targetType: "tenant",
        targetId: ctx.tenant.id,
        meta: { from: ctx.tenant.timezone, to: timezone },
      });
    });
  } catch (err) {
    console.error("setTenantTimezoneAction failed", err);
    return { error: "Something went wrong. Please try again." };
  }

  // Every dashboard page renders a date somewhere, so none of them are still
  // correct on the old zone.
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
