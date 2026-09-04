import "server-only";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { MarketingError, friendlyMessage } from "./core/errors";
import type { MarketingCtx } from "./kit-ops";

/**
 * The one gate for every Marketing write, shared by `actions.ts` (the brand
 * kit) and `site-actions.ts` (the website) so the two files cannot answer
 * "who may change how the business looks?" differently.
 *
 * **EVERY WRITE IS OWNER-ONLY, and not as a matter of taste.** How the
 * business looks to its customers is a decision, not a chore
 * (`src/lib/packs/authorize.ts` draws that line for the packs, and this is the
 * same line). Staff see the kit and the site and cannot change them; the
 * accountant is read-only here as in every core module.
 */
export type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

export async function gate(): Promise<MarketingCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "marketing");
  if (ctx.role === "expert") {
    throw new MarketingError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  if (ctx.role !== "owner") {
    throw new MarketingError("FORBIDDEN", "owner role required");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

export function fail(err: unknown): { error: string } {
  if (!(err instanceof MarketingError)) {
    console.error("marketing action failed", err);
  }
  return { error: friendlyMessage(err) };
}
