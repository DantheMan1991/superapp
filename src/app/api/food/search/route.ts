import { NextResponse, type NextRequest } from "next/server";
import { withTenant } from "@/db";
import { resolvePersonalContext } from "@/lib/auth";
import { routeGate } from "@/lib/modules";
import { searchFoods, searchRecipes } from "@/modules/food/eating-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

/**
 * THE LOG FOOD SEARCH (Food D4a, docs/help/food/log.md): the person's recipes
 * whose name has the words, and the food list's best matches, as they type.
 * A GET with the words in the query, not a server action: actions queue one
 * behind another, and a search box must be able to drop the answer to the
 * last keystroke when the next one comes. Only words reach the database, as
 * bound parameters (`searchWords`); the food list is read under its read
 * policy and the recipes under the space's RLS. Nothing is written.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const ctx = await resolvePersonalContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: HEADERS });
  const refused = await routeGate(ctx.tenant.id, "food");
  if (refused) return refused;
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 120);
  const [foods, recipes] = await withTenant(
    ctx.tenant.id,
    async (tx) => [await searchFoods(tx, q, 25), await searchRecipes(tx, ctx.tenant.id, q, 5)] as const,
    { role: ctx.role },
  );
  return NextResponse.json({ foods, recipes }, { headers: HEADERS });
}
