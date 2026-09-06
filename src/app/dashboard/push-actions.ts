"use server";

import { z } from "zod";
import { schema, withSystem } from "@/db";
import { requireTenant } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

/**
 * The mobile app registers the phone it is running on. Called by
 * src/components/app/push-registration.tsx once the shell has handed the
 * page a device token; idempotent, so a second call with the same token is a
 * "still here".
 *
 * Written under `withSystem` after `requireTenant()`, and here is why that
 * is right rather than lazy: a device token names a PHONE, and a phone
 * changes hands — somebody signs out, somebody else signs in. The row for
 * that token then belongs to the previous person, whom the new one may not
 * see, so an upsert in tenant context would be refused by the own-rows-only
 * policy at exactly the moment it matters. The action binds the row to the
 * verified caller and nothing else; what it stores is opaque to everyone.
 */

const RegisterInput = z.object({
  token: z.string().min(16).max(4096),
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().max(40).default(""),
});

export type RegisterPushDeviceResult = { ok: true } | { ok: false; error: string };

export async function registerPushDeviceAction(
  input: unknown,
): Promise<RegisterPushDeviceResult> {
  const parsed = RegisterInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That does not look like a device." };
  const ctx = await requireTenant();
  const { token, platform, appVersion } = parsed.data;
  const now = new Date();
  const [row] = await withSystem((tx) =>
    tx
      .insert(schema.pushDevices)
      .values({
        clerkUserId: ctx.userId,
        platform,
        token,
        appVersion,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: schema.pushDevices.token,
        set: {
          clerkUserId: ctx.userId,
          platform,
          appVersion,
          lastSeenAt: now,
          disabledAt: null,
          disabledReason: null,
        },
      })
      .returning({ id: schema.pushDevices.id }),
  );
  await logAudit({
    action: "push.device_registered",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "push_device",
    targetId: row?.id ?? null,
    meta: { platform, appVersion },
  });
  return { ok: true };
}
