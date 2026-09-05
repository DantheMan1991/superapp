import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { SiteEnquiry } from "@/db/schema";
import { MarketingError } from "./core/errors";
import type { MarketingCtx } from "./kit-ops";

/**
 * The owner's side of `site_enquiries`: reading one and removing it. The
 * write that CREATES a row is the public path's (`src/lib/sites/enquiries.ts`);
 * nothing here edits a row, because an enquiry is never edited.
 *
 * Removing an enquiry removes the record of the message only. The contact it
 * became and the follow-up it raised are the workspace's now and stay: a
 * spam message deleted here still leaves a party and an item the owner
 * deletes where they live, which the screen says.
 */
export async function findEnquiry(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<SiteEnquiry | null> {
  const row = await tx.query.siteEnquiries.findFirst({
    where: and(eq(schema.siteEnquiries.tenantId, tenantId), eq(schema.siteEnquiries.id, id)),
  });
  return row ?? null;
}

export async function deleteEnquiry(
  tx: Tx,
  ctx: MarketingCtx,
  id: string,
): Promise<SiteEnquiry> {
  const [deleted] = await tx
    .delete(schema.siteEnquiries)
    .where(and(eq(schema.siteEnquiries.tenantId, ctx.tenantId), eq(schema.siteEnquiries.id, id)))
    .returning();
  // Zero rows is how RLS says no to a DELETE; treat it as the refusal it is.
  if (!deleted) throw new MarketingError("ENQUIRY_MISSING", "no such enquiry");
  return deleted;
}
