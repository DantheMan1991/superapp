"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { logAuditInTx } from "@/lib/audit";

const inputSchema = z.object({
  membershipId: z.string().uuid(),
  accountant: z.boolean(),
});

/**
 * Flag a non-owner member as the outside accountant ("expert" role) or back
 * to staff. Owner-only; the flag is a LOCAL overlay on the Clerk-derived
 * role — tenant-sync preserves it across membership webhooks.
 */
export async function setMemberAccountantAction(
  input: z.infer<typeof inputSchema>,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireTenantOwner();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { membershipId, accountant } = parsed.data;

  try {
    const result = await withTenant(ctx.tenant.id, async (tx) => {
      const [row] = await tx
        .select({
          id: schema.memberships.id,
          role: schema.memberships.role,
          profileId: schema.memberships.profileId,
          clerkUserId: schema.profiles.clerkUserId,
        })
        .from(schema.memberships)
        .innerJoin(
          schema.profiles,
          eq(schema.profiles.id, schema.memberships.profileId),
        )
        .where(
          and(
            eq(schema.memberships.id, membershipId),
            eq(schema.memberships.tenantId, ctx.tenant.id),
          ),
        )
        .limit(1);
      if (!row) return { error: "That member no longer exists." };
      if (row.role === "owner") {
        return { error: "Owners already have full access." };
      }
      if (row.clerkUserId === ctx.userId) {
        return { error: "You can't change your own access." };
      }

      await tx
        .update(schema.memberships)
        .set({ role: accountant ? "expert" : "staff" })
        .where(eq(schema.memberships.id, row.id));
      await logAuditInTx(tx, {
        action: "team.accountant_set",
        tenantId: ctx.tenant.id,
        actorClerkUserId: ctx.userId,
        targetType: "membership",
        targetId: row.id,
        meta: { profileId: row.profileId, accountant },
      });
      return { ok: true as const };
    });
    if ("error" in result) return result;
    revalidatePath("/dashboard/team");
    return { ok: true };
  } catch (err) {
    console.error("setMemberAccountantAction failed", err);
    return { error: "Something went wrong. Please try again." };
  }
}
