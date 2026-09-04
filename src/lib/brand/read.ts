import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { get } from "@vercel/blob";
import { schema, type Tx } from "@/db";
import type { BrandKit } from "@/db/schema";
import { blobToken } from "@/lib/blob";
import { resolveBrand, type ResolvedBrand } from "./core";

/**
 * Reading the brand kit — the Layer 0 seam every consumer goes through.
 *
 * Takes the caller's `tx` rather than opening one, so a consumer reads the
 * brand inside the same tenant transaction as the document it is rendering.
 * Members hold SELECT on `brand_kits`, so no role is needed to read it.
 *
 * Writing lives in the Marketing module (`src/modules/marketing/`), which is
 * the one place that decides who may change the business's look.
 */

/** Every kit a tenant has: the business-wide one and any per-company ones. */
export async function loadBrandKits(
  tx: Tx,
  tenantId: string,
): Promise<BrandKit[]> {
  return tx.query.brandKits.findMany({
    where: eq(schema.brandKits.tenantId, tenantId),
  });
}

/**
 * What a company looks like, resolved over the business-wide kit
 * (`resolveBrand`). `entityId` null asks for the business-wide look itself,
 * which is what a document with no company — or a tenant with no books —
 * uses.
 */
export async function resolveBrandFor(
  tx: Tx,
  tenantId: string,
  entityId: string | null,
): Promise<ResolvedBrand> {
  const [tenant, business, company] = await Promise.all([
    tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
      columns: { name: true },
    }),
    tx.query.brandKits.findFirst({
      where: and(
        eq(schema.brandKits.tenantId, tenantId),
        isNull(schema.brandKits.entityId),
      ),
    }),
    entityId
      ? tx.query.brandKits.findFirst({
          where: and(
            eq(schema.brandKits.tenantId, tenantId),
            eq(schema.brandKits.entityId, entityId),
          ),
        })
      : Promise.resolve(undefined),
  ]);
  return resolveBrand({
    tenantName: tenant?.name ?? "",
    business: business ?? null,
    company: company ?? null,
  });
}

/**
 * The logo's bytes, for a renderer that embeds them (the PDF). Network, so
 * call it OUTSIDE any transaction — the house rule for every blob read. Null
 * when the blob is gone: a missing logo must degrade to no logo, never to a
 * failed invoice.
 */
export async function loadLogoBytes(
  pathname: string,
): Promise<Uint8Array | null> {
  try {
    const result = await get(pathname, { access: "private", token: blobToken() });
    if (!result || result.statusCode !== 200) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  } catch (err) {
    console.error("brand logo read failed", err);
    return null;
  }
}
