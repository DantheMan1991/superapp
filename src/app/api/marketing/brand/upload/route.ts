import { NextRequest, NextResponse } from "next/server";
import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { blobToken, brandPathPrefix, isTenantBlobPath } from "@/lib/blob";
import {
  BRAND_LOGO_MAX_BYTES,
  BRAND_LOGO_MIME_TYPES,
} from "@/lib/brand/core";

export const runtime = "nodejs";

/**
 * Presigned-URL issuance for a brand logo.
 *
 * A deliberate sibling of `/api/documents/blob/upload` rather than a
 * parameter on it: one route answering to two module gates has cross-module
 * privilege escalation as its failure mode, and the forty duplicated lines are
 * cheaper than that (the reasoning is on that route).
 *
 * Owner-only, like every write in the Marketing module: the logo on every
 * invoice is a decision. The token is scoped to this tenant's brand prefix,
 * to the two image types the kit accepts, and to 2MB; registration
 * (`setBrandLogoAction`) then re-checks the REAL bytes, because a token
 * restricts what the client declares, not what it sends.
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
          throw new Error("only an owner can change the logo");
        }
        if (!(await isModuleEnabled(ctx.tenant.id, "marketing"))) {
          throw new Error("module disabled");
        }
        if (
          !pathname.startsWith(brandPathPrefix(ctx.tenant.id)) ||
          !isTenantBlobPath(ctx.tenant.id, pathname)
        ) {
          throw new Error("pathname outside tenant namespace");
        }
        const token = await issueSignedToken({
          token: blobToken(),
          pathname,
          operations: ["put"],
          validUntil: Date.now() + 10 * 60_000,
          allowedContentTypes: [...BRAND_LOGO_MIME_TYPES],
          maximumSizeInBytes: BRAND_LOGO_MAX_BYTES,
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
