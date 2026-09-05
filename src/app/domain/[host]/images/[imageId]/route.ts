import type { NextRequest } from "next/server";
import { siteImageResponse } from "@/lib/sites/images";
import { lookupSiteByDomain } from "@/lib/sites/read";

export const runtime = "nodejs";

/** A published site's photo, addressed by a domain the business connected. See `src/lib/sites/images.ts`. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ host: string; imageId: string }> },
): Promise<Response> {
  const { host, imageId } = await params;
  return siteImageResponse(
    await lookupSiteByDomain(host.toLowerCase()),
    imageId,
    req.headers.get("if-none-match"),
  );
}
