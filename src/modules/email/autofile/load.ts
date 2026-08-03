import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import type { MailAutofileRule } from "@/db/schema";
import {
  enabledMailExtensions,
  entityTypeIndex,
  filingTargetFor,
} from "@/lib/mail-extensions/resolve";

/**
 * Reading somebody's auto-filing rules, and the folders one may point at.
 *
 * IT LIVES HERE, NOT IN actions.ts — the same reason `rules/load.ts` gives.
 * `actions.ts` begins with `"use server"` and every export becomes a callable
 * endpoint; this takes `tenantId`, `userId` and `role` and feeds them into
 * `withTenant`, which SETS the RLS context from them. As an action it would be
 * a way to read any tenant's rules by asking for them.
 */

export async function loadAutofileRules(
  tenantId: string,
  userId: string,
  role: "owner" | "staff" | "expert",
  mailAccountId: string,
): Promise<MailAutofileRule[]> {
  return withTenant(
    tenantId,
    (tx) =>
      tx
        .select()
        .from(schema.mailAutofileRules)
        .where(
          and(
            eq(schema.mailAutofileRules.tenantId, tenantId),
            eq(schema.mailAutofileRules.mailAccountId, mailAccountId),
          ),
        )
        .orderBy(asc(schema.mailAutofileRules.name)),
    { role, userId },
  );
}

export interface FilingDestination {
  id: string;
  label: string;
}

/**
 * The Documents folders a rule may file into.
 *
 * **READ AS `staff`, ALWAYS — even when the person configuring the rule is an
 * owner.** That is not a mistake and it is the whole point: the sweep runs from
 * a cron with no session, `requireTenant()` derives "owner" from Clerk's
 * organization role, and a cron has no way to obtain one. So the sweep is
 * `staff` and can never write into an owners-only folder.
 *
 * Offering one here would produce a rule that looked configured and filed
 * nothing, every night, silently. Asking the question with the SWEEP'S OWN
 * credentials means the list is exactly what will work later, rather than a
 * second rule about visibility that could drift from the first — mail does not
 * have to know what "owners-only" even means, because RLS removes those rows
 * for a staff caller before they arrive.
 *
 * Passing a role LOWER than the caller's is the safe direction, and `'staff'`
 * is the documented default in `withTenant`. The prohibition in AGENTS.md is
 * against claiming a role somebody does not have.
 */
export async function loadFilingDestinations(
  tenantId: string,
  userId: string,
  query: string,
): Promise<FilingDestination[]> {
  const extensions = await enabledMailExtensions(tenantId);
  const filer = filingTargetFor(extensions);
  if (!filer?.filing) return [];

  const folderType = entityTypeIndex([filer]).get("folder");
  if (!folderType) return [];

  const found = await withTenant(
    tenantId,
    (tx) =>
      folderType.entityType.search(
        tx,
        { tenantId, userId, role: "staff" },
        query,
        20,
      ),
    { role: "staff", userId },
  );
  return found.map((f) => ({ id: f.entityId, label: f.label }));
}

/**
 * Can the sweep actually write into this folder?
 *
 * The same question `loadFilingDestinations` answers for a list, asked of one
 * id at save time — because the list is a suggestion and the id that arrives in
 * the action is a claim. Resolving it as `staff` is what proves the sweep will
 * be able to use it.
 */
export async function filingDestinationIsUsable(
  tenantId: string,
  userId: string,
  folderId: string,
): Promise<boolean> {
  const extensions = await enabledMailExtensions(tenantId);
  const filer = filingTargetFor(extensions);
  const folderType = filer ? entityTypeIndex([filer]).get("folder") : null;
  if (!folderType) return false;

  const resolved = await withTenant(
    tenantId,
    (tx) =>
      folderType.entityType.resolve(
        tx,
        { tenantId, userId, role: "staff" },
        [folderId],
      ),
    { role: "staff", userId },
  );
  return resolved.length > 0;
}
