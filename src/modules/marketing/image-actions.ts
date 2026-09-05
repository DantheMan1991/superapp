"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import type { SiteImage } from "@/db/schema";
import { logAuditInTx } from "@/lib/audit";
import { MarketingError } from "./core/errors";
import { fail, gate, type ActionResult } from "./gate";
import { deleteSiteImage, insertSiteImage } from "./image-ops";
import { discardPhotoBlob, inspectUploadedPhoto } from "./photo-ingest";
import { findSite } from "./site-ops";

/**
 * The site's photo library: adding a photo after the browser uploaded it,
 * and removing one. Owner-only through the module's one gate. Blob work
 * happens outside every transaction; a row that could not be written takes
 * its blob with it, so the store never holds a photo no row vouches for.
 */
const BASE = "/dashboard/m/marketing/website";

function revalidateSite(): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/pages/[pageId]`, "page");
  revalidatePath("/sites/[slug]/[[...path]]", "page");
  revalidatePath("/hosted/[slug]/[[...path]]", "page");
  revalidatePath("/domain/[host]/[[...path]]", "page");
}

/** What the editor's picker shows for one photo. */
export interface SitePhotoView {
  id: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
  createdAt: string;
}

export async function toPhotoView(row: SiteImage): Promise<SitePhotoView> {
  return {
    id: row.id,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    mimeType: row.mimeType,
    createdAt: row.createdAt.toISOString(),
  };
}

const registerInput = z.object({ pathname: z.string().min(1).max(500) });

export async function registerSitePhotoAction(input: unknown): Promise<ActionResult<SitePhotoView>> {
  try {
    const ctx = await gate();
    const parsed = registerInput.safeParse(input);
    if (!parsed.success) return { error: "Choose a photo and try again." };
    const site = await withTenant(ctx.tenantId, (tx) => findSite(tx, ctx.tenantId), { role: ctx.role });
    if (!site) throw new MarketingError("SITE_MISSING", "no site");

    // Network, outside the transaction: reads the real bytes, keeps only
    // the derivative, and has already discarded the upload when it returns.
    const photo = await inspectUploadedPhoto(ctx.tenantId, parsed.data.pathname);
    let row: SiteImage;
    try {
      row = await withTenant(
        ctx.tenantId,
        async (tx) => {
          const created = await insertSiteImage(tx, ctx, site.id, photo);
          await logAuditInTx(tx, {
            action: "marketing.site.photo_added",
            tenantId: ctx.tenantId,
            actorClerkUserId: ctx.userId,
            targetType: "site_image",
            targetId: created.id,
            meta: { siteId: site.id, width: created.width, height: created.height, bytes: created.bytes },
          });
          return created;
        },
        { role: ctx.role },
      );
    } catch (err) {
      // No row vouches for it: the derivative goes too.
      await discardPhotoBlob(photo.pathname);
      throw err;
    }
    revalidateSite();
    return { ok: true, data: await toPhotoView(row) };
  } catch (err) {
    return fail(err);
  }
}

const idInput = z.object({ id: z.string().uuid() });

export async function deleteSitePhotoAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return { error: "Pick a photo and try again." };
    const row = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const deleted = await deleteSiteImage(tx, ctx, parsed.data.id);
        await logAuditInTx(tx, {
          action: "marketing.site.photo_removed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site_image",
          targetId: deleted.id,
          meta: { siteId: deleted.siteId },
        });
        return deleted;
      },
      { role: ctx.role },
    );
    // The row is gone; the bytes follow. A failure here is logged, not
    // surfaced — the photo is off every page either way.
    await discardPhotoBlob(row.pathname);
    revalidateSite();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
