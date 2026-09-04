import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { streamBlobResponse } from "@/lib/blob-stream";

export const runtime = "nodejs";

/**
 * A kit's logo, for signed-in members of its tenant.
 *
 * Auth is re-checked on every fetch: the tenant, then RLS proves the kit is
 * this tenant's. Another tenant's kit id returns the same 404 as no kit at
 * all. Not gated on the Marketing module: the brand is Layer 0 data with
 * consumers of its own (the invoice PDF reads the same blob server-side), and
 * a member looking at the business's own logo needs no feature switched on to
 * do it.
 *
 * Nothing here is public. The website will want a public URL for the same
 * bytes; that is a separate route with its own rules, when it exists.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const { id } = await params;
  const ctx = await resolveTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const kit = await withTenant(
    ctx.tenant.id,
    (tx) =>
      tx.query.brandKits.findFirst({
        where: and(
          eq(schema.brandKits.tenantId, ctx.tenant.id),
          eq(schema.brandKits.id, id),
        ),
        columns: { logoPathname: true, logoMimeType: true },
      }),
    { role: ctx.role },
  );
  if (!kit?.logoPathname) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const response = await streamBlobResponse({
    pathname: kit.logoPathname,
    mimeType: kit.logoMimeType,
    fileName: kit.logoMimeType === "image/png" ? "logo.png" : "logo.jpg",
    disposition: "inline",
    ifNoneMatch: req.headers.get("if-none-match") ?? undefined,
  });
  if (!response) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return response;
}
