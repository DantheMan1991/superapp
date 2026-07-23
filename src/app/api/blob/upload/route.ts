import { NextRequest, NextResponse } from "next/server";
import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { blobToken, receiptPathPrefix } from "@/lib/blob";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
} from "@/modules/accounting/documents/allowlist";

export const runtime = "nodejs";

/**
 * Presigned-URL issuance for client-direct blob uploads — the named
 * exception to the server-actions convention (phone photos exceed the
 * 4MB action body limit). PRIVATE stores require the presigned flow
 * (classic client tokens are rejected by the store — learned in
 * production). The auth story is unchanged: this callback re-checks
 * tenant + module and pins the pathname to the caller's own namespace
 * before any URL is signed. DB registration is a separate server action
 * the client calls after the upload.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadPresignedBody;
  try {
    const result = await handleUploadPresigned({
      body,
      request: req,
      // Only used to verify upload-completed callbacks, which we don't
      // register (P4) — a placeholder keeps local dev working without it.
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY ?? "unconfigured",
      getSignedToken: async (pathname) => {
        const ctx = await resolveTenantContext();
        if (!ctx) throw new Error("unauthorized");
        if (!(await isModuleEnabled(ctx.tenant.id, "accounting"))) {
          throw new Error("module disabled");
        }
        if (!pathname.startsWith(receiptPathPrefix(ctx.tenant.id))) {
          throw new Error("pathname outside tenant namespace");
        }
        const token = await issueSignedToken({
          token: blobToken(),
          pathname,
          operations: ["put"],
          validUntil: Date.now() + 10 * 60_000,
          allowedContentTypes: [...ALLOWED_MIME_TYPES],
          maximumSizeInBytes: MAX_FILE_BYTES,
        });
        return {
          token,
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
