"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";

const inputSchema = z.object({ daily: z.boolean() });

/**
 * Turn the morning email on or off, for yourself, in this workspace.
 *
 * NOT owner-gated, and that is the point — this is the one setting in the
 * product that belongs to the reader rather than to the business. An owner able
 * to switch a staff member's digest off would be deciding what somebody else
 * gets told about their own work.
 *
 * Notice what is NOT here: any check that the row belongs to the caller. The
 * policy on `notification_preferences` (drizzle/0090) joins to `profiles` and
 * compares `clerk_user_id` against `app_current_user()`, so the database will
 * not let this write anybody else's row even if the code asked it to. Passing
 * `{ role, userId }` to `withTenant` is what supplies that identity — and
 * forgetting it makes the write match nothing rather than everything.
 */
export async function setDigestPreferenceAction(
  input: z.infer<typeof inputSchema>,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireTenant();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const digest = parsed.data.daily ? "daily" : "off";

  try {
    const ok = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const [me] = await tx
          .select({ id: schema.profiles.id })
          .from(schema.profiles)
          .where(eq(schema.profiles.clerkUserId, ctx.userId))
          .limit(1);
        // A profile the caller cannot see means the webhook has not synced
        // them yet. Nothing to write, and nothing alarming.
        if (!me) return false;

        const rows = await tx
          .insert(schema.notificationPreferences)
          .values({ tenantId: ctx.tenant.id, profileId: me.id, digest })
          .onConflictDoUpdate({
            target: [
              schema.notificationPreferences.tenantId,
              schema.notificationPreferences.profileId,
            ],
            set: { digest, updatedAt: new Date() },
          })
          .returning({ id: schema.notificationPreferences.id });
        return rows.length > 0;
      },
      { role: ctx.role, userId: ctx.userId },
    );

    if (!ok) return { error: "We couldn't save that. Please try again." };
  } catch (err) {
    console.error("setDigestPreferenceAction failed", err);
    return { error: "Something went wrong. Please try again." };
  }

  revalidatePath("/dashboard/today");
  return { ok: true };
}
