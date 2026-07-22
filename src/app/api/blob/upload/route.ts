import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { assertBlobConfigured, receiptPathPrefix } from "@/lib/blob";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
} from "@/modules/accounting/documents/allowlist";

export const runtime = "nodejs";

/**
 * Token issuance for client-direct blob uploads — the named exception to
 * the server-actions convention (phone photos exceed the 4MB action body
 * limit). The auth story is equivalent: this callback re-checks tenant +
 * module and pins the pathname to the caller's own namespace before any
 * token exists. DB registration is a separate server action the client
 * calls after the upload (onUploadCompleted cannot fire on localhost).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  assertBlobConfigured();
  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const ctx = await resolveTenantContext();
        if (!ctx) throw new Error("unauthorized");
        if (!(await isModuleEnabled(ctx.tenant.id, "accounting"))) {
          throw new Error("module disabled");
        }
        if (!pathname.startsWith(receiptPathPrefix(ctx.tenant.id))) {
          throw new Error("pathname outside tenant namespace");
        }
        return {
          allowedContentTypes: [...ALLOWED_MIME_TYPES],
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60_000,
          tokenPayload: JSON.stringify({
            tenantId: ctx.tenant.id,
            userId: ctx.userId,
          }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        // Not the registration path (P4) — the client registers via a
        // server action so the flow works on localhost too.
        console.log("blob upload completed", blob.pathname);
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "upload rejected";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
