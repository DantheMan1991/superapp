import { NextResponse, type NextRequest } from "next/server";
import { withTenant } from "@/db";
import { resolvePersonalContext } from "@/lib/auth";
import { routeGate } from "@/lib/modules";
import { searchUsda } from "@/modules/food/eating-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

/**
 * THE INGREDIENT SEARCH (Food D4, docs/help/food/recipe-nutrition.md): USDA's
 * ingredient list's best matches as the person types, to change the food a
 * recipe's line was matched to. A GET the box can drop, as the food search
 * (`/api/food/search`) is; only words reach the database, as bound
 * parameters, and the list is read under its read policy. Nothing is written.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const ctx = await resolvePersonalContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: HEADERS });
  const refused = await routeGate(ctx.tenant.id, "food");
  if (refused) return refused;
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 120);
  const foods = await withTenant(ctx.tenant.id, (tx) => searchUsda(tx, "food_usda_ingredients", q, 25), { role: ctx.role });
  return NextResponse.json({ foods }, { headers: HEADERS });
}
