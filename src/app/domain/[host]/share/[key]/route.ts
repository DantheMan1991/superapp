import type { NextRequest } from "next/server";
import { siteShareResponse } from "@/lib/sites/share";

export const runtime = "nodejs";

/** A published page's share image, reached through a domain the business connected. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ host: string; key: string }> }): Promise<Response> {
  const { host, key } = await params;
  return siteShareResponse({ by: "domain", host: host.toLowerCase() }, key, req.headers.get("if-none-match"));
}
