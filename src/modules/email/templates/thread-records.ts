import "server-only";
import { withTenant } from "@/db";
import { enabledMailExtensions } from "@/lib/mail-extensions/resolve";
import type { LinkableEntity } from "@/lib/mail-extensions/types";
import { listLinksForThread, resolveLinks } from "../links";

/**
 * The business records this conversation is already attached to.
 *
 * WHY THE COMPOSER WANTS THEM. A template saying `{{invoice.number}}` has to be
 * told which invoice, and asking is honest but repetitive: chasing the same
 * unpaid invoice four times means finding it four times, from a thread that is
 * already attached to it. The link is the answer somebody has already given.
 *
 * Reuses the reading pane's own two-step (`listLinksForThread` then
 * `resolveLinks`) rather than querying the extensions directly, so "which
 * records is this thread attached to?" has one implementation. `resolveLinks`
 * also drops ids that no longer resolve — deleted, or hidden by RLS — which is
 * exactly the filtering this needs: a record the person cannot see must not be
 * offered as a default, and it must not be distinguishable from one that is
 * gone.
 *
 * Returns [] rather than throwing for a new message, which has no thread yet.
 */
export async function threadRecordsForCompose(
  tenantId: string,
  userId: string,
  role: "owner" | "staff" | "expert",
  ref: { mailAccountId: string; threadId: string } | null,
): Promise<LinkableEntity[]> {
  if (!ref || ref.threadId.length === 0) return [];

  const extensions = await enabledMailExtensions(tenantId);
  const scope = { tenantId, userId, role };

  const resolved = await withTenant(
    tenantId,
    async (tx) => {
      const rows = await listLinksForThread(tx, tenantId, ref);
      return resolveLinks(tx, scope, extensions, rows);
    },
    { role, userId },
  );

  /**
   * A link whose `entity` is null did not resolve — the record is gone, or RLS
   * hid it from this caller. Dropping those is the point rather than tidying:
   * a record somebody cannot see must never become the silent default that
   * fills an invoice number into a customer's email, and "restricted" and
   * "deleted" have to stay indistinguishable here as everywhere else.
   */
  return resolved.flatMap((link) => (link.entity ? [link.entity] : []));
}
