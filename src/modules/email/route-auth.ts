import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import type { MailAccount } from "@/db/schema";

/**
 * The auth prologue both mail routes share.
 *
 * Route handlers answer JSON and never redirect (docs/security.md §4), and they
 * return **404 rather than 403** for anything that is not the caller's — a 403
 * confirms the resource exists, which for a mailbox is itself a disclosure.
 *
 * The account read goes through `withTenant(..., { userId })`, so the per-user
 * policy from `0043` is what proves ownership rather than a predicate somebody
 * has to remember. A colleague's account id resolves to nothing here, exactly
 * as an invented one does.
 */

export type RouteGate =
  | { ok: true; tenantId: string; userId: string; account: MailAccount }
  | { ok: false; response: Response };

const notFound = () =>
  new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });

export async function gateMailRoute(accountId: string): Promise<RouteGate> {
  const ctx = await resolveTenantContext();
  if (!ctx) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  // Mail is denied to the external accountant outright — the mailbox holds
  // correspondence well outside the remit somebody was given to close books.
  if (ctx.role === "expert") return { ok: false, response: notFound() };

  if (!(await isModuleEnabled(ctx.tenant.id, "email"))) {
    return { ok: false, response: notFound() };
  }

  if (!/^[0-9a-f-]{36}$/i.test(accountId)) {
    return { ok: false, response: notFound() };
  }

  const account = await withTenant(
    ctx.tenant.id,
    (tx) =>
      tx.query.mailAccounts.findFirst({
        where: and(
          eq(schema.mailAccounts.tenantId, ctx.tenant.id),
          eq(schema.mailAccounts.id, accountId),
          eq(schema.mailAccounts.clerkUserId, ctx.userId),
        ),
      }),
    { role: ctx.role, userId: ctx.userId },
  );
  if (!account || account.status !== "connected") {
    return { ok: false, response: notFound() };
  }

  return { ok: true, tenantId: ctx.tenant.id, userId: ctx.userId, account };
}

export { notFound as mailRouteNotFound };
