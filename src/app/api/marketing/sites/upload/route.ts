import { NextRequest, NextResponse } from "next/server";
import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { blobToken, isTenantBlobPath, sitePhotoPathPrefix } from "@/lib/blob";
import { PHOTO_MAX_BYTES, PHOTO_UPLOAD_MIME_TYPES } from "@/lib/sites/photo";

export const runtime = "nodejs";

/**
 * The presigned-upload door for a site's photos — the brand logo's twin.
 *
 * The browser asks for a token, uploads straight to the blob store under
 * the tenant's own prefix, then registers the blob through
 * `registerSitePhotoAction`, which re-reads the real bytes and keeps only
 * the derivative it makes (ADR 0023). The token bounds the declared type
 * and size; registration is what decides.
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
        if (ctx.role !== "owner") {
          throw new Error("only an owner can add photos to the website");
        }
        if (!(await isModuleEnabled(ctx.tenant.id, "marketing"))) {
          throw new Error("module disabled");
        }
        if (
          !pathname.startsWith(sitePhotoPathPrefix(ctx.tenant.id)) ||
          !isTenantBlobPath(ctx.tenant.id, pathname)
        ) {
          throw new Error("pathname outside tenant namespace");
        }
        const token = await issueSignedToken({
          token: blobToken(),
          pathname,
          operations: ["put"],
          validUntil: Date.now() + 10 * 60_000,
          allowedContentTypes: [...PHOTO_UPLOAD_MIME_TYPES],
          maximumSizeInBytes: PHOTO_MAX_BYTES,
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
