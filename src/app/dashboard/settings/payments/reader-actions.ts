"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { requireTenant, requireTenantOwner } from "@/lib/auth";
import {
  TerminalError,
  archiveReader,
  cancelCollection,
  collectPayment,
  readPaymentStatus,
  registerReader,
  renameReader,
  simulateTap,
} from "@/lib/payments/terminal";

/**
 * The reader's write surface.
 *
 * **REGISTERING IS OWNER, TAKING A PAYMENT IS MEMBER**, and the split is the
 * one `retail` already draws: choosing which company's bank a device pays into
 * is a decision, and standing at a stall taking money is a chore. A till only
 * the owner could operate is a till nobody uses.
 */

const PATH = "/dashboard/settings/payments";

function toResult(err: unknown): { error: string } {
  if (err instanceof TerminalError) return { error: err.message };
  console.error("reader action failed", err);
  return { error: "Something went wrong. Please try again." };
}

const addressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(50),
  postalCode: z.string().trim().min(1).max(20),
});

export async function registerReaderAction(
  input: unknown,
): Promise<{ ok?: true; error?: string }> {
  const ctx = await requireTenantOwner();
  const parsed = z
    .object({
      /** A claim; proved against `entities` inside the tenant scope below. */
      entityId: z.string().uuid().nullable(),
      label: z.string().trim().min(1).max(100),
      /**
       * Printed on the reader's own screen, or `simulated-wpe` for Stripe's
       * simulated device. Stripe validates it; this only keeps obvious rubbish
       * out of an API call.
       */
      registrationCode: z.string().trim().min(3).max(100),
      address: addressSchema.nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  let companyName = ctx.tenant.name;
  if (parsed.data.entityId) {
    const entity = await withTenant(
      ctx.tenant.id,
      (tx) =>
        tx.query.entities.findFirst({
          where: eq(schema.entities.id, parsed.data.entityId!),
          columns: { name: true },
        }),
      { role: ctx.role },
    );
    // 404-shaped, never 403: do not confirm another tenant's company exists.
    if (!entity) return { error: "That company no longer exists." };
    companyName = entity.name;
  }

  try {
    await registerReader({
      tenantId: ctx.tenant.id,
      entityId: parsed.data.entityId,
      companyName,
      label: parsed.data.label,
      registrationCode: parsed.data.registrationCode,
      address: parsed.data.address,
      role: ctx.role,
      actorClerkUserId: ctx.userId,
    });
  } catch (err) {
    return toResult(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function renameReaderAction(
  input: unknown,
): Promise<{ ok?: true; error?: string }> {
  const ctx = await requireTenantOwner();
  const parsed = z
    .object({
      readerId: z.string().uuid(),
      label: z.string().trim().min(1).max(100),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Give the reader a name." };
  try {
    await renameReader({ tenantId: ctx.tenant.id, ...parsed.data, role: ctx.role });
  } catch (err) {
    return toResult(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function archiveReaderAction(
  input: unknown,
): Promise<{ ok?: true; error?: string }> {
  const ctx = await requireTenantOwner();
  const parsed = z.object({ readerId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "That reader no longer exists." };
  try {
    await archiveReader({
      tenantId: ctx.tenant.id,
      readerId: parsed.data.readerId,
      role: ctx.role,
      actorClerkUserId: ctx.userId,
    });
  } catch (err) {
    return toResult(err);
  }
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * **MEMBER, NOT OWNER.** Whoever is standing at the stall takes the money.
 *
 * Deliberately does NOT revalidate: a till waiting on a page refresh between
 * customers is a till nobody can use, which is the lesson `retail`'s own POS
 * already learned the hard way.
 */
export async function collectPaymentAction(
  input: unknown,
): Promise<{
  stripePaymentIntentId?: string;
  status?: string;
  error?: string;
}> {
  const ctx = await requireTenant();
  const parsed = z
    .object({
      readerId: z.string().uuid(),
      /** Integer cents. The boundary is integer-only; dollars convert in the form. */
      amountCents: z.number().int().min(1).max(10_000_000_000),
      description: z.string().trim().max(200).optional(),
      /**
       * Minted by the caller BEFORE it touches the network. Without it a retry
       * charges the customer twice — the same rule as `retail_sales.client_ref`.
       */
      clientRef: z.string().trim().min(8).max(100),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the amount and try again." };

  try {
    const result = await collectPayment({
      tenantId: ctx.tenant.id,
      ...parsed.data,
      role: ctx.role,
    });
    return {
      stripePaymentIntentId: result.stripePaymentIntentId,
      status: result.status,
    };
  } catch (err) {
    return toResult(err);
  }
}

export async function readPaymentStatusAction(
  input: unknown,
): Promise<{ status?: string; failureMessage?: string | null; error?: string }> {
  const ctx = await requireTenant();
  const parsed = z
    .object({
      readerId: z.string().uuid(),
      stripePaymentIntentId: z.string().trim().min(3).max(100),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "That payment no longer exists." };
  try {
    return await readPaymentStatus({
      tenantId: ctx.tenant.id,
      ...parsed.data,
      role: ctx.role,
    });
  } catch (err) {
    return toResult(err);
  }
}

export async function cancelCollectionAction(
  input: unknown,
): Promise<{ ok?: true; error?: string }> {
  const ctx = await requireTenant();
  const parsed = z.object({ readerId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "That reader no longer exists." };
  try {
    await cancelCollection({
      tenantId: ctx.tenant.id,
      readerId: parsed.data.readerId,
      role: ctx.role,
    });
  } catch (err) {
    return toResult(err);
  }
  return { ok: true };
}

/**
 * Simulate a tap. Refuses anything that is not a simulated device, so it cannot
 * be pointed at a real reader in front of a real customer.
 */
export async function simulateTapAction(
  input: unknown,
): Promise<{ ok?: true; error?: string }> {
  const ctx = await requireTenant();
  const parsed = z.object({ readerId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "That reader no longer exists." };
  try {
    await simulateTap({
      tenantId: ctx.tenant.id,
      readerId: parsed.data.readerId,
      role: ctx.role,
    });
  } catch (err) {
    return toResult(err);
  }
  return { ok: true };
}
