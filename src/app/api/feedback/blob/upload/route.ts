import { NextRequest, NextResponse } from "next/server";
import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { resolveTenantContext } from "@/lib/auth";
import { blobToken, feedbackPathPrefix, isTenantBlobPath } from "@/lib/blob";
import {
  FEEDBACK_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/feedback/attachments";

export const runtime = "nodejs";

/**
 * Presigned-URL issuance for a screenshot on a feedback report.
 *
 * A DELIBERATE SIBLING of the accounting and Documents upload routes rather
 * than a parameterized version of either — the reasoning is written out in
 * `/api/documents/blob/upload` and holds here: one route answering to several
 * gates has privilege escalation as its failure mode, and forty duplicated
 * lines are cheaper than that. Each door is auditable on its own.
 *
 * Two things differ from its siblings, both deliberate:
 *
 *  * **No module gate.** Feedback is platform-level and on for everybody; there
 *    is no `feedback` row in `modules` to check. The tenant gate is the whole
 *    gate.
 *  * **An EXPERT may upload.** The other doors refuse the outside accountant
 *    because they are write paths into the business's records. This one is not:
 *    an accountant who hits a bug in the product has the same right to show us
 *    a picture of it as anybody else, and what they are writing is their own
 *    support thread rather than the client's books.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadPresignedBody;
  try {
    const result = await handleUploadPresigned({
      body,
      request: req,
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY ?? "unconfigured",
      getSignedToken: async (pathname) => {
        const ctx = await resolveTenantContext();
        if (!ctx) throw new Error("unauthorized");
        /*
          A SUPPORT VIEW MAY NOT UPLOAD. `resolveTenantContext` hands back the
          client's workspace for a superadmin who is looking at it, and this is
          a POST — the same refusal `requireTenant` makes for a server action,
          restated here because a route handler does not go through it.
        */
        if (ctx.support) throw new Error("support view is read-only");
        // Its own namespace, and only its own. `isTenantBlobPath` additionally
        // refuses traversal and backslashes: the keyspace is flat so ".."
        // resolves nowhere, but a key that merely LOOKS like an escape has no
        // business being minted.
        if (
          !pathname.startsWith(feedbackPathPrefix(ctx.tenant.id)) ||
          !isTenantBlobPath(ctx.tenant.id, pathname)
        ) {
          throw new Error("pathname outside tenant namespace");
        }
        const token = await issueSignedToken({
          token: blobToken(),
          pathname,
          operations: ["put"],
          validUntil: Date.now() + 10 * 60_000,
          // The REAL enforcement of the allowlist. The picker's own check is a
          // courtesy that saves a round trip; this is the one that binds.
          allowedContentTypes: [...FEEDBACK_MIME_TYPES],
          maximumSizeInBytes: MAX_ATTACHMENT_BYTES,
        });
        return {
          token,
          // Two people sending "Screenshot 2026-09-13.png" must not collide,
          // and the unique index on `blob_pathname` would refuse the second.
          urlOptions: { addRandomSuffix: true },
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "upload rejected";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
