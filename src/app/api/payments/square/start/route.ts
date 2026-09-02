import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { logAudit } from "@/lib/audit";
import { resolveTenantContext } from "@/lib/auth";
import { SQUARE_NOT_CONFIGURED, squareConfig } from "@/lib/payments/square/config";
import {
  buildSquareAuthorizeUrl,
  createSquareState,
} from "@/lib/payments/square/oauth";
import { storePendingSquare } from "@/lib/payments/square/pending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start connecting a company's Square account.
 *
 * Sends the OWNER to Square to authorise Yosher. A route rather than a server
 * action because the response is a redirect to a third party — the same
 * reasoning as `/api/email/oauth/start`. `resolveTenantContext` rather than
 * `requireTenant`, because a route handler answers with JSON, never a redirect
 * to a login page (security.md §4).
 *
 * **OWNER ONLY, AND NOT AS A MATTER OF TASTE.** This decides which bank
 * account the business's card takings land in. Staff work the till; they do
 * not choose where the money goes.
 */
const QuerySchema = z.object({
  /** A company id, or `none` for the tenant that has no books and so no company. */
  entity: z.union([z.string().uuid(), z.literal("none")]),
  /** Joined against our own origin by the callback, so it cannot become an open redirect. */
  returnTo: z.string().startsWith("/").max(200).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const ctx = await resolveTenantContext();
  if (!ctx) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (ctx.role !== "owner") {
    return NextResponse.json(
      { error: "Only the business owner can connect Square." },
      { status: 403 },
    );
  }

  const config = squareConfig();
  if (!config) {
    return NextResponse.json({ error: SQUARE_NOT_CONFIGURED }, { status: 503 });
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    entity: url.searchParams.get("entity") ?? undefined,
    returnTo: url.searchParams.get("returnTo") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick a company and try again." }, { status: 400 });
  }
  const entityId = parsed.data.entity === "none" ? null : parsed.data.entity;

  /**
   * **THE COMPANY ID IS A CLAIM.** Proved against `entities` inside the
   * caller's own tenant scope; the scope is what makes it impossible to bind a
   * Square account to another tenant's company.
   */
  const companies = await withTenant(
    ctx.tenant.id,
    (tx) =>
      tx.query.entities.findMany({
        where: eq(schema.entities.tenantId, ctx.tenant.id),
        columns: { id: true },
      }),
    { role: ctx.role },
  );
  if (entityId) {
    // 404-shaped rather than 403-shaped: never confirm that another tenant's
    // company exists (security.md §4).
    if (!companies.some((c) => c.id === entityId)) {
      return NextResponse.json({ error: "That company no longer exists." }, { status: 404 });
    }
  } else if (companies.length > 0) {
    // The books exist, so a connection with no company is not a state this can
    // create. Adoption runs on page load; the caller is out of date.
    return NextResponse.json(
      { error: "Pick which company this Square account is for." },
      { status: 400 },
    );
  }

  const state = createSquareState();
  await storePendingSquare({
    state,
    tenantId: ctx.tenant.id,
    entityId,
    returnTo: parsed.data.returnTo ?? "/dashboard/settings/payments",
    issuedAt: Date.now(),
  });

  await logAudit({
    action: "payments.square_connect_started",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "entity",
    targetId: entityId ?? "unassigned",
  });

  return NextResponse.redirect(buildSquareAuthorizeUrl(config, { state }));
}
