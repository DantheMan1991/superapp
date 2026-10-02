import { withTenant } from "@/db";
import { resolvePersonalContext } from "@/lib/auth";
import { routeGate } from "@/lib/modules";
import { photoResponse } from "@/modules/food/photo-ops";
import { loadRecipe } from "@/modules/food/recipe-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A RECIPE'S PHOTO (Food D1). The personal space's door for a route, then
 * Food's gate, then the recipe's own row under RLS: the row is what says the
 * photo is this person's to see. The store is private; nothing links to it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found.", { status: 404 });
  const ctx = await resolvePersonalContext();
  if (!ctx) return new Response("Sign in first.", { status: 401 });
  const refused = await routeGate(ctx.tenant.id, "food");
  if (refused) return refused;
  const row = await withTenant(ctx.tenant.id, (tx) => loadRecipe(tx, ctx.tenant.id, id), { role: ctx.role });
  if (!row?.photoPathname) return new Response("Not found.", { status: 404 });
  const response = await photoResponse(row.photoPathname, request.headers.get("if-none-match"));
  return response ?? new Response("Not found.", { status: 404 });
}
