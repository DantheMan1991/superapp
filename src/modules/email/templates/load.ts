import "server-only";
import { asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import type { MailTemplate } from "@/db/schema";

/**
 * Reading the business's templates.
 *
 * IT LIVES HERE, NOT IN actions.ts, for the reason `rules/load.ts` spells out:
 * `actions.ts` begins with `"use server"`, and every export from such a module
 * becomes a callable endpoint. This function takes `tenantId` and `role` and
 * feeds them into `withTenant`, which SETS the RLS context from them — as an
 * action it would be a way to read any tenant's templates by asking. RLS cannot
 * help when it is being told who to be. `server-only` is the opposite
 * guarantee: not callable from a browser, and a build error if imported into a
 * client component.
 *
 * No `userId` here, unlike every other mail loader. `mail_templates` is
 * tenant-scoped rather than per-user (drizzle/0056) — a template is the
 * business's boilerplate, not somebody's correspondence — so the policy matches
 * on tenant alone and passing a user would be noise suggesting a scope that
 * does not exist.
 */
export async function loadTemplates(
  tenantId: string,
  role: "owner" | "staff" | "expert",
): Promise<MailTemplate[]> {
  /**
   * The external accountant is refused here, not only in the actions.
   *
   * Every other mail loader is protected by the per-user policy — an expert has
   * no `mail_accounts` row, so a rules or saved-search read returns nothing
   * whatever the caller does. **This table is tenant-scoped, so RLS would hand
   * them the rows.** Today MailView is only reachable with a connected mailbox,
   * which an expert cannot have, so nothing changes in practice; the guard is
   * here so that stays true if a future caller reads templates from somewhere
   * that does not need a connection. Mail is denied to the accountant outright
   * (`route-auth.ts`) and a template is business correspondence in draft.
   */
  if (role === "expert") return [];

  return withTenant(
    tenantId,
    (tx) =>
      tx
        .select()
        .from(schema.mailTemplates)
        .where(eq(schema.mailTemplates.tenantId, tenantId))
        // By name, because the picker is something people scan while they are
        // in the middle of writing. Recency would move things under the cursor.
        .orderBy(asc(schema.mailTemplates.nameKey)),
    { role },
  );
}
