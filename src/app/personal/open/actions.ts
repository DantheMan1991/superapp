"use server";

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { isSuperAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PersonalSpaceError, provisionPersonalSpace } from "@/lib/personal-space";

const openSchema = z.object({
  // The browser's own zone. Checked again by `provisionPersonalSpace` against
  // the runtime, which is the check that matters; this only bounds the input.
  timezone: z.string().trim().max(64).optional(),
});

export type OpenOutcome = { ok: true; clerkOrgId: string } | { error: string };

/**
 * MAKE — OR FIND — THE CALLER'S PERSONAL SPACE (ADR 0111).
 *
 * Who is asking comes from Clerk's session and nothing else; the input carries
 * only a timezone. Not `requireTenant()`: the caller's active workspace is
 * their business, or nothing at all, and neither is what this acts on. The
 * space it returns is the caller's by construction — `provisionPersonalSpace`
 * looks it up, and makes it, by this user's id.
 *
 * Returns the organization to switch to. The switch itself is the browser's
 * (`setActive`), because the active organization is part of the Clerk session
 * and only the client can change it.
 */
export async function createPersonalSpaceAction(
  input: z.infer<typeof openSchema>,
): Promise<OpenOutcome> {
  const { userId } = await auth();
  if (!userId) return { error: "Sign in to open your personal space." };
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) return { error: "That request could not be read. Try again." };

  try {
    const { tenant, created } = await provisionPersonalSpace({
      clerkUserId: userId,
      timezone: parsed.data.timezone ?? null,
      isSuperAdmin: await isSuperAdmin(),
    });
    if (created) {
      await logAudit({
        action: "personal_space.created",
        tenantId: tenant.id,
        actorClerkUserId: userId,
        actorLabel: "personal-space",
      });
    }
    if (!tenant.clerkOrgId) {
      return { error: "Your personal space could not be opened. Try again in a moment." };
    }
    return { ok: true, clerkOrgId: tenant.clerkOrgId };
  } catch (err) {
    if (err instanceof PersonalSpaceError) {
      return { error: "Personal spaces are not open yet." };
    }
    console.error("personal space: provisioning failed", err);
    return { error: "Your personal space could not be made. Try again in a moment." };
  }
}
