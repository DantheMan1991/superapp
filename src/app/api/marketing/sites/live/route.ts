import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { loadLiveData } from "@/lib/sites/read";
import { PAGE_SECTIONS_MAX, SectionSchema } from "@/lib/sites/schema";

export const runtime = "nodejs";

/**
 * What a draft page would show live, for the editor's preview (slice 13):
 * the views of the pack blocks these sections carry and the events
 * calendar when one asks for it — the same reads the draft route makes,
 * for sections that are not saved yet. Members of the tenant only; the
 * sections come from the client and are parsed through the content model
 * before anything reads them; nothing is written.
 */
const Body = z.object({ sections: z.array(SectionSchema).max(PAGE_SECTIONS_MAX) });

export async function POST(req: NextRequest): Promise<Response> {
  const ctx = await resolveTenantContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const data = await withTenant(ctx.tenant.id, (tx) => loadLiveData(tx, ctx.tenant.id, parsed.data.sections), { role: ctx.role });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
