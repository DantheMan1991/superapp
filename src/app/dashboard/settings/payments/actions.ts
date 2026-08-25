"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { ConnectError, startOnboarding } from "@/lib/payments/connect";

/**
 * **OWNER ONLY, AND NOT AS A MATTER OF TASTE.** This decides which bank account
 * the business's card takings land in and whose tax ID they are reported under.
 * Staff record what happened at a stall; they do not choose where the money
 * goes.
 */
const inputSchema = z.object({
  /**
   * Which company. Null only for a tenant with no books at all — `retail`
   * requires `inventory`, not `accounting`, so that is a real state.
   *
   * **A CLAIM, NOT A FACT.** It is proved against `entities` inside the
   * caller's own `withTenant` scope below; the scope is what makes it
   * impossible to name another tenant's company.
   */
  entityId: z.string().uuid().nullable(),
});

export async function startPaymentOnboardingAction(
  input: unknown,
): Promise<{ url?: string; error?: string }> {
  const ctx = await requireTenantOwner();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Pick a company and try again." };
  const { entityId } = parsed.data;

  const companies = await withTenant(
    ctx.tenant.id,
    (tx) =>
      tx.query.entities.findMany({
        where: eq(schema.entities.tenantId, ctx.tenant.id),
        columns: { id: true, name: true },
      }),
    { role: ctx.role },
  );

  let entityName = ctx.tenant.name;
  if (entityId) {
    const match = companies.find((c) => c.id === entityId);
    // 404-shaped rather than 403-shaped: never confirm that another tenant's
    // company exists (security.md §4).
    if (!match) return { error: "That company no longer exists." };
    entityName = match.name;
  } else if (companies.length > 0) {
    // The books exist, so an account with no company is not a state this can
    // create. Adoption runs on page load; the caller is out of date.
    return { error: "Pick which company this Stripe account is for." };
  }

  try {
    const { url } = await startOnboarding({
      tenantId: ctx.tenant.id,
      tenantName: ctx.tenant.name,
      entityId,
      entityName,
      actorClerkUserId: ctx.userId,
    });
    revalidatePath("/dashboard/settings/payments");
    return { url };
  } catch (err) {
    if (err instanceof ConnectError) return { error: err.message };
    console.error("startPaymentOnboardingAction failed", err);
    return { error: "Something went wrong. Please try again." };
  }
}

/**
 * Composite FK targets and validation aside, there is deliberately NO action
 * here that writes `payment_accounts`. Every column on that table is Stripe's
 * verdict (S7), members hold SELECT only, and the write path is
 * `syncConnectedAccount` under `withSystem`. If a future slice wants a
 * "disconnect" button, it calls Stripe and lets the webhook write the row.
 */
