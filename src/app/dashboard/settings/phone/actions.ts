"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { logAudit } from "@/lib/audit";
import { requireTenant } from "@/lib/auth";
import { isShareSecretConfigured } from "@/lib/public-token";
import { DeviceGrantError, mintGrant, revokeGrant } from "@/lib/device-grants/ops";

type ActionResult<T> = { ok: true; data: T } | { error: string };

/**
 * Setting up and switching off the phones that may speak to this workspace
 * (ADR 0048).
 *
 * `requireTenant()`, NOT `requireTenantOwner()`, even though every sibling in
 * `/dashboard/settings` is owner-only. Those change how the BUSINESS behaves;
 * this changes how ONE PERSON's own phone behaves, and a farmhand who cannot
 * set up their own phone has no way to use the feature at all. The rows are
 * scoped to the caller by policy, so staff minting here reaches nothing of
 * anybody else's.
 */
const addSchema = z.object({
  label: z.string().min(1).max(60),
  platform: z.enum(["ios", "android"]),
});

export async function addPhoneAction(
  input: z.infer<typeof addSchema>,
): Promise<ActionResult<{ token: string }>> {
  const ctx = await requireTenant();
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { error: "Give the phone a name." };

  // Fail closed and say so, rather than minting a credential that cannot be
  // hashed. `public-token.ts` throws without the secret; this turns that into
  // a sentence somebody can act on.
  if (!isShareSecretConfigured()) {
    return { error: "This platform is not set up for phones yet (SHARE_SECRET)." };
  }

  try {
    const token = await withTenant(
      ctx.tenant.id,
      (tx) =>
        mintGrant(
          tx,
          { tenantId: ctx.tenant.id, userId: ctx.userId },
          { label: parsed.data.label, platform: parsed.data.platform },
        ),
      { role: ctx.role, userId: ctx.userId },
    );

    await logAudit({
      action: "device_grant.minted",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "device_grant",
      // The LABEL, never the token and never its hash.
      meta: { platform: parsed.data.platform },
    });

    revalidatePath("/dashboard/settings/phone");
    // The only time this value exists outside the phone. Shown once.
    return { ok: true, data: { token } };
  } catch (err) {
    if (err instanceof DeviceGrantError) return { error: err.message };
    throw err;
  }
}

const revokeSchema = z.object({ id: z.string().uuid() });

export async function revokePhoneAction(
  input: z.infer<typeof revokeSchema>,
): Promise<ActionResult<undefined>> {
  const ctx = await requireTenant();
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  await withTenant(
    ctx.tenant.id,
    (tx) => revokeGrant(tx, parsed.data.id),
    { role: ctx.role, userId: ctx.userId },
  );

  await logAudit({
    action: "device_grant.revoked",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "device_grant",
    targetId: parsed.data.id,
  });

  revalidatePath("/dashboard/settings/phone");
  return { ok: true, data: undefined };
}
