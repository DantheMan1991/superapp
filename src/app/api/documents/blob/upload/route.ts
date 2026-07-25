import { NextRequest, NextResponse } from "next/server";
import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { blobToken, dmsPathPrefix } from "@/lib/blob";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
} from "@/modules/documents/allowlist";

export const runtime = "nodejs";

/**
 * Presigned-URL issuance for Documents uploads — the same named exception to
 * the server-actions convention as the accounting route (a 4MB action body
 * cannot carry a set of drawings), and private stores require the presigned
 * flow.
 *
 * A deliberate sibling rather than a parameterized version of
 * /api/blob/upload. One route answering to two module gates has cross-module
 * privilege escalation as its failure mode, and the duplicated forty lines are
 * cheaper than that. Each route is auditable on its own.
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
        // Uploads are a write path — the expert (accountant) role is read-only.
        if (ctx.role === "expert") {
          throw new Error("accountant access is read-only");
        }
        if (!(await isModuleEnabled(ctx.tenant.id, "documents"))) {
          throw new Error("module disabled");
        }
        // A client can only ever write into its own tenant's namespace.
        if (!pathname.startsWith(dmsPathPrefix(ctx.tenant.id, "files"))) {
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
