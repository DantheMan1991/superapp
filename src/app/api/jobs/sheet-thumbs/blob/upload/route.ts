import { NextRequest, NextResponse } from "next/server";
import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { blobToken, isTenantBlobPath, sheetThumbPathPrefix } from "@/lib/blob";
import { PACK } from "@/packs/jobs/vocabulary";

export const runtime = "nodejs";

/** A page's picture is a few KB; anything near this is not one. */
const MAX_THUMB_BYTES = 512 * 1024;

/**
 * Presigned issuance for a drawing page's picture.
 *
 * **A DELIBERATE SIBLING of the Documents upload route**, for the reason that
 * one states in its own words: a single route answering to two module gates
 * has cross-module privilege escalation as its failure mode, and forty
 * duplicated lines are cheaper than that. This one gates on the JOBS pack and
 * will only ever sign a path under this tenant's sheet-thumbnail prefix, for
 * a JPEG, at a few hundred KB.
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
        /** Indexing a set is a write; the accountant role is read-only. */
        if (ctx.role === "expert") {
          throw new Error("accountant access is read-only");
        }
        if (!(await isModuleEnabled(ctx.tenant.id, PACK))) {
          throw new Error("module disabled");
        }
        if (
          !pathname.startsWith(sheetThumbPathPrefix(ctx.tenant.id)) ||
          !isTenantBlobPath(ctx.tenant.id, pathname)
        ) {
          throw new Error("pathname outside tenant namespace");
        }
        const token = await issueSignedToken({
          token: blobToken(),
          pathname,
          operations: ["put"],
          validUntil: Date.now() + 10 * 60_000,
          allowedContentTypes: ["image/jpeg"],
          maximumSizeInBytes: MAX_THUMB_BYTES,
        });
        return {
          token,
          /**
           * **NO RANDOM SUFFIX.** The pathname IS the identity here — page 12
           * of this file has one picture — so a re-read must overwrite it
           * rather than leave a second copy nothing can find.
           */
          urlOptions: { addRandomSuffix: false, allowOverwrite: true },
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "upload rejected";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
