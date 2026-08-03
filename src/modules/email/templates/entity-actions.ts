"use server";

import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import {
  enabledMailExtensions,
  entityTypeIndex,
} from "@/lib/mail-extensions/resolve";
import type { LinkableEntity } from "@/lib/mail-extensions/types";
import { MailError, friendlyMessage } from "../core/errors";

/**
 * Choosing the record a template's placeholders refer to, and reading its
 * fields.
 *
 * Two actions, both scoped to ONE entity type, because a template that says
 * `{{invoice.number}}` is asking "which invoice" and nothing else. Searching
 * every type would offer customers and documents to a question about invoices.
 *
 * Both go through `withTenant` under the CALLER'S role and user, and both hand
 * that `tx` to the extension — the seam's standing rule. What a template can
 * reveal is therefore exactly what the person inserting it may already read.
 */

type ActionResult<T> = { ok: true; data: T } | { error: string };

async function gate() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "email");
  if (ctx.role === "expert") {
    throw new MailError("FORBIDDEN_EXPERT", "accountant has no mail access");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

const searchSchema = z.object({
  entityType: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  query: z.string().max(200),
});

export async function searchTemplateEntitiesAction(
  input: z.infer<typeof searchSchema>,
): Promise<ActionResult<LinkableEntity[]>> {
  try {
    const ctx = await gate();
    const parsed = searchSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const index = entityTypeIndex(await enabledMailExtensions(ctx.tenantId));
    const entry = index.get(parsed.data.entityType);
    // An unknown or switched-off type yields an empty list rather than an
    // error: the module may have been turned off since the template was
    // written, and that is a "nothing to choose" rather than a fault.
    if (!entry) return { ok: true, data: [] };

    const results = await withTenant(
      ctx.tenantId,
      (tx) => entry.entityType.search(tx, ctx, parsed.data.query, 10),
      { role: ctx.role, userId: ctx.userId },
    );
    return { ok: true, data: results };
  } catch (err) {
    if (!(err instanceof MailError)) console.error("template entity search failed", err);
    return { error: friendlyMessage(err) };
  }
}

const valuesSchema = z.object({
  entityType: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  entityId: z.string().uuid(),
});

/**
 * The field values for one chosen record, namespaced ready for substitution.
 *
 * Returns `{}` rather than an error when the record cannot be read, and the
 * two cases are indistinguishable on purpose — "not yours" and "not there"
 * give the same answer, so this cannot be used to probe for records. The
 * composer then leaves the tokens visible, which is the same behaviour as a
 * recipient that has not been typed yet.
 */
export async function templateEntityValuesAction(
  input: z.infer<typeof valuesSchema>,
): Promise<ActionResult<Record<string, string>>> {
  try {
    const ctx = await gate();
    const parsed = valuesSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const index = entityTypeIndex(await enabledMailExtensions(ctx.tenantId));
    const entry = index.get(parsed.data.entityType);
    if (!entry?.entityType.templateValues) return { ok: true, data: {} };

    const values = await withTenant(
      ctx.tenantId,
      (tx) =>
        entry.entityType.templateValues!(tx, ctx, parsed.data.entityId),
      { role: ctx.role, userId: ctx.userId },
    );
    if (!values) return { ok: true, data: {} };

    // Namespaced HERE rather than by the extension, so an extension cannot
    // contribute a key outside its own namespace — `invoice` can never fill
    // `{{customer.email}}`, whatever it returns.
    const out: Record<string, string> = {};
    const allowed = new Set(
      (entry.entityType.templateFields ?? []).map((f) => f.key),
    );
    for (const [key, value] of Object.entries(values)) {
      // …and only the fields it DECLARED, so the vocabulary the editor listed
      // and the values that arrive cannot drift apart.
      if (!allowed.has(key)) continue;
      out[`${parsed.data.entityType}.${key}`] = value;
    }
    return { ok: true, data: out };
  } catch (err) {
    if (!(err instanceof MailError)) console.error("template entity values failed", err);
    return { error: friendlyMessage(err) };
  }
}
