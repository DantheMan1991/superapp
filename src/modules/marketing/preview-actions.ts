"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { hashToken, isShareSecretConfigured, mintToken } from "@/lib/public-token";
import { MarketingError } from "./core/errors";
import { fail, gate, type ActionResult } from "./gate";
import { findSiteById } from "./site-ops";

/**
 * PREVIEW LINKS — showing an unpublished site to somebody who cannot sign in
 * (ADR 0046).
 *
 * The point of the website tool is handing a business its site, and until
 * this existed the only way to show one was to publish it: `/sites/<slug>/draft`
 * demands a member of that tenant. This is what an agency sends a client
 * before anything is on the internet.
 *
 * Owner-only through the module's one gate, like every other write here. The
 * raw token exists for exactly as long as this function runs: what is stored
 * is its keyed hash for lookup and its ciphertext so the link can be shown
 * again, which is the document share's arrangement (`share-actions.ts`).
 */

const BASE = "/dashboard/m/marketing/website";

const createInput = z.object({
  siteId: z.string().uuid(),
  label: z.string().trim().max(80).default(""),
  /**
   * How long a link lasts — long enough for a client to get to it, and never
   * forever (the one rule kept whole from the document share). A closed list
   * rather than a number, so nothing can ask for a decade.
   *
   * Inline and not a named export: this file is `"use server"`, where every
   * export is a server action and a plain constant is a build error
   * (`tests/use-server-exports.test.ts`).
   */
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
});

function previewUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return `${base}/p/${token}`;
}

export async function createPreviewLinkAction(
  input: unknown,
): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await gate();
    const parsed = createInput.safeParse(input);
    if (!parsed.success) return { error: "Check the fields and try again." };
    // Fail closed and say so: with no secret the token cannot be keyed, and a
    // link that cannot be verified must never be handed out.
    if (!isShareSecretConfigured()) {
      throw new MarketingError("STORAGE_UNAVAILABLE", "SHARE_SECRET is not set");
    }
    const { siteId, label, days } = parsed.data;
    const token = mintToken();
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSiteById(tx, ctx.tenantId, siteId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        const [created] = await tx
          .insert(schema.sitePreviews)
          .values({
            tenantId: ctx.tenantId,
            siteId: site.id,
            tokenHash: hashToken(token),
            tokenCiphertext: encryptSecret(token),
            label,
            expiresAt,
            createdByClerkUserId: ctx.userId,
          })
          .returning({ id: schema.sitePreviews.id });
        // Zero rows is how RLS says no to an INSERT; treat it as the refusal.
        if (!created) throw new MarketingError("FORBIDDEN", "link not created");
        await logAuditInTx(tx, {
          action: "marketing.site.preview_created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site_preview",
          targetId: created.id,
          // Identifiers and the shape only. NEVER the token — an audit row
          // that carried it would be a copy of the secret.
          meta: { siteId: site.id, slug: site.slug, days, labelled: label !== "" },
        });
      },
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true, data: { url: previewUrl(token) } };
  } catch (err) {
    return fail(err);
  }
}

const oneInput = z.object({ previewId: z.string().uuid() });

/**
 * Stop a link working. The row STAYS — `revoked_at` is set, not the row
 * deleted — so who made it, when, and whether it was ever opened survives the
 * revocation. A preview link is something handed to somebody outside the
 * business, and the record of it is not the owner's to erase.
 */
export async function revokePreviewLinkAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = oneInput.safeParse(input);
    if (!parsed.success) return { error: "Which link?" };
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const [updated] = await tx
          .update(schema.sitePreviews)
          .set({ revokedAt: new Date(), revokedByClerkUserId: ctx.userId })
          .where(
            and(
              eq(schema.sitePreviews.tenantId, ctx.tenantId),
              eq(schema.sitePreviews.id, parsed.data.previewId),
              // Revoking twice is not an error, but it must not move the date.
              isNull(schema.sitePreviews.revokedAt),
            ),
          )
          .returning({ id: schema.sitePreviews.id });
        if (!updated) return;
        await logAuditInTx(tx, {
          action: "marketing.site.preview_revoked",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site_preview",
          targetId: updated.id,
        });
      },
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The link again, for somebody who closed the dialog before copying it.
 *
 * Decrypting on demand rather than keeping the raw token anywhere is the
 * whole reason the ciphertext column exists: a database read on its own never
 * yields a working link, because `APP_ENCRYPTION_KEY` lives in the
 * environment.
 */
export async function revealPreviewLinkAction(
  input: unknown,
): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await gate();
    const parsed = oneInput.safeParse(input);
    if (!parsed.success) return { error: "Which link?" };
    const row = await withTenant(
      ctx.tenantId,
      (tx) =>
        tx.query.sitePreviews.findFirst({
          where: and(
            eq(schema.sitePreviews.tenantId, ctx.tenantId),
            eq(schema.sitePreviews.id, parsed.data.previewId),
          ),
          columns: { tokenCiphertext: true, revokedAt: true, expiresAt: true },
        }),
      { role: ctx.role },
    );
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new MarketingError("PREVIEW_GONE", "no live link");
    }
    return { ok: true, data: { url: previewUrl(decryptSecret(row.tokenCiphertext)) } };
  } catch (err) {
    return fail(err);
  }
}
