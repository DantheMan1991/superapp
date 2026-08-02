"use server";

import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { logAudit } from "@/lib/audit";
import {
  enabledMailExtensions,
  imageSourcesFrom,
  searchInsertableImages,
} from "@/lib/mail-extensions/resolve";
import type { MailImageCandidate } from "@/lib/mail-extensions/types";
import { authorizedClient, loadConnection } from "@/lib/email/oauth/accounts";
import { MailError, friendlyMessage } from "./core/errors";
import {
  isInlineImageType,
  MAX_INLINE_IMAGE_BYTES,
  mintCid,
  type InlineImage,
} from "./compose/inline";
import { inlinePreviewUrl } from "./render/signing";

/**
 * Inserting a picture from the business's own files.
 *
 * The founder asked for this alongside upload-from-disk: the photograph somebody
 * wants to put in a quote is usually already in Documents, and making them
 * download it first to attach it back is the kind of round trip a platform
 * exists to remove.
 *
 * **MAIL DOES NOT IMPORT DOCUMENTS.** `eslint.config.mjs` forbids it and that
 * rule is the whole reason `src/lib/mail-extensions/` exists. This goes through
 * the registry: Documents contributes an image source, Mail asks the registry
 * what sources exist, and neither names the other. A second source — an industry
 * pack's photo library, say — is a registry entry rather than a change here.
 *
 * WHAT MAKES IT SAFE IS THE TRANSACTION, not a check in this file. Both hooks
 * take the CALLER'S `tx`, so `documents` RLS has already decided what this
 * person can see, including the owners-only folders whose `effective_visibility`
 * hides them from staff. There is deliberately no visibility predicate anywhere
 * below — adding one would be a second place for that rule to be wrong.
 */

type ActionResult<T> = { ok: true; data: T } | { error: string };

interface MailCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

async function gate(): Promise<MailCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "email");
  if (ctx.role === "expert") {
    throw new MailError("FORBIDDEN_EXPERT", "accountant has no mail access");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (!(err instanceof MailError)) console.error("mail image action failed", err);
  return { error: friendlyMessage(err) };
}

/** How many to offer per source. A picker for finding, not for browsing. */
const SEARCH_LIMIT = 24;

export interface ImageSearchGroup {
  extensionSlug: string;
  label: string;
  images: MailImageCandidate[];
}

/**
 * Pictures the caller may insert, grouped by where they came from.
 *
 * An empty query lists the most recent rather than nothing, unlike the entity
 * picker: somebody inserting a photograph is browsing, and "type to see
 * anything" in front of an empty panel reads as a broken feature.
 */
export async function searchInsertableImagesAction(
  query: string,
): Promise<ActionResult<ImageSearchGroup[]>> {
  try {
    const ctx = await gate();
    const groups = await withTenant(
      ctx.tenantId,
      (tx) =>
        searchInsertableImages(
          tx,
          { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
          typeof query === "string" ? query.slice(0, 200) : "",
          SEARCH_LIMIT,
        ),
      // BOTH are required, and for different reasons. `role` is what the
      // Documents visibility policy reads to tell an owner from staff; without
      // it every caller is treated as staff and owners lose their own folders.
      { role: ctx.role, userId: ctx.userId },
    );
    return { ok: true, data: groups };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Resolve one picture and put it on the mail server.
 *
 * THE ORDER HERE IS THE DESIGN. The permission check happens inside the
 * transaction, where RLS applies; the bytes are fetched after it closes,
 * because the house rule is that network work never happens inside a
 * transaction; and the upload to the mail server happens last, so nothing is
 * created anywhere until the caller has been proved entitled to the file.
 */
export async function insertImageFromSourceAction(input: {
  mailboxId: string;
  extensionSlug: string;
  imageId: string;
}): Promise<ActionResult<InlineImage>> {
  try {
    const ctx = await gate();
    const { mailboxId, extensionSlug, imageId } = input;
    if (
      typeof mailboxId !== "string" ||
      typeof extensionSlug !== "string" ||
      typeof imageId !== "string"
    ) {
      throw new MailError("SEND_FAILED", "bad image request");
    }

    const extensions = await enabledMailExtensions(ctx.tenantId);
    const source = imageSourcesFrom(extensions).find(
      (e) => e.slug === extensionSlug,
    );
    // A source whose module was switched off between opening the picker and
    // clicking is the ordinary case here, not an attack.
    if (!source?.images) throw new MailError("SEND_FAILED", "no such image source");

    // The mailbox id is a claim; RLS is what proves it.
    const account = await loadConnection(ctx.tenantId, ctx.userId, mailboxId);
    if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");

    const resolved = await withTenant(
      ctx.tenantId,
      (tx) =>
        source.images!.open(
          tx,
          { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
          imageId,
        ),
      { role: ctx.role, userId: ctx.userId },
    );
    // Null means "not yours" and "not there" identically — see the contract.
    if (!resolved) throw new MailError("SEND_FAILED", "image not available");
    if (!isInlineImageType(resolved.type)) {
      throw new MailError("SEND_FAILED", "not an image we can inline");
    }
    if (resolved.size > MAX_INLINE_IMAGE_BYTES) {
      throw new MailError("SEND_FAILED", "that image is too large to inline");
    }

    // Outside the transaction. See the header.
    const bytes = await resolved.fetch();
    if (!bytes) throw new MailError("SEND_FAILED", "image not available");
    if (bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
      // Checked again against what actually arrived: the first check trusted a
      // size column, and a row can disagree with its blob.
      throw new MailError("SEND_FAILED", "that image is too large to inline");
    }

    const client = await authorizedClient(account);
    if (!client.ok) {
      throw new MailError(
        client.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "MAIL_SERVER_UNREACHABLE",
        client.message,
      );
    }
    const uploaded = await client.data.uploadBlob(
      new Uint8Array(bytes),
      resolved.type,
    );
    if (!uploaded.ok) {
      // The mail server's own sentence: it knows its size limits and its quota.
      throw new MailError("SEND_FAILED", uploaded.message);
    }

    await logAudit({
      action: "mail.image_inserted",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      targetType: "mailbox",
      targetId: mailboxId,
      // Identifiers and sizes only — never the file name, which is a description
      // of the tenant's own document and belongs in Documents' own audit trail
      // rather than a superadmin-visible one (S9).
      meta: {
        source: extensionSlug,
        bytes: uploaded.data.size,
        type: uploaded.data.type,
      },
    });

    return {
      ok: true,
      data: {
        blobId: uploaded.data.blobId,
        cid: mintCid(),
        type: uploaded.data.type,
        name: resolved.name,
        size: uploaded.data.size,
        previewUrl: inlinePreviewUrl({
          tenantId: ctx.tenantId,
          clerkUserId: ctx.userId,
          mailAccountId: account.id,
          blobId: uploaded.data.blobId,
          type: uploaded.data.type,
          fileName: resolved.name,
        }),
      },
    };
  } catch (err) {
    return fail(err);
  }
}
