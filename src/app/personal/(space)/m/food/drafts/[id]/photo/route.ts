import { withTenant } from "@/db";
import { resolvePersonalContext } from "@/lib/auth";
import { routeGate } from "@/lib/modules";
import { getImport } from "@/modules/food/import-ops";
import { photoResponse } from "@/modules/food/photo-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A DRAFT'S PHOTO (Food D1): the recipe page's own photo, kept for the draft
 * until it is saved or discarded. The personal space's door for a route, then
 * Food's gate, then the draft's own row under RLS: the row is what says the
 * photo is this person's to see.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found.", { status: 404 });
  const ctx = await resolvePersonalContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  const refused = await routeGate(ctx.tenant.id, "food");
  if (refused) return refused;
  const row = await withTenant(ctx.tenant.id, (tx) => getImport(tx, ctx.tenant.id, id), { role: ctx.role });
  if (!row?.photoPathname) return new Response("Not found.", { status: 404 });
  const response = await photoResponse(row.photoPathname, request.headers.get("if-none-match"));
  return response ?? new Response("Not found.", { status: 404 });
}
