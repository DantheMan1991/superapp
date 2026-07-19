"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";

const addItemSchema = z.object({
  title: z.string().trim().min(1, "Say something!").max(200),
});

export async function addHelloItem(formData: FormData): Promise<void> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "hello");

  const parsed = addItemSchema.safeParse({ title: formData.get("title") });
  if (!parsed.success) return;

  await withTenant(ctx.tenant.id, (tx) =>
    tx.insert(schema.helloItems).values({
      tenantId: ctx.tenant.id,
      title: parsed.data.title,
      createdByClerkUserId: ctx.userId,
    }),
  );

  revalidatePath("/dashboard/m/hello");
}

export async function deleteHelloItem(formData: FormData): Promise<void> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "hello");

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;

  // Belt (app-level tenant filter) and suspenders (RLS) — the delete is
  // double-scoped even though RLS alone would already block cross-tenant rows.
  await withTenant(ctx.tenant.id, (tx) =>
    tx
      .delete(schema.helloItems)
      .where(
        and(
          eq(schema.helloItems.id, id.data),
          eq(schema.helloItems.tenantId, ctx.tenant.id),
        ),
      ),
  );

  await logAudit({
    action: "hello.item_deleted",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "hello_item",
    targetId: id.data,
  });

  revalidatePath("/dashboard/m/hello");
}
