"use server";

import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { authorizedClient, loadConnection } from "@/lib/email/oauth/accounts";
import { searchExtensionContacts } from "@/lib/mail-extensions/resolve";
import { MailError, friendlyMessage } from "../core/errors";
import { excludeChosen, rankContacts, type ContactSuggestion } from "./rank";
import { recentCorrespondents } from "./recent";

/**
 * Who to write to.
 *
 * THREE SOURCES, ASKED CONCURRENTLY, and none of them is allowed to be the
 * reason a composer stops working:
 *
 *   1. **Recent correspondents** — `mail_thread_index`, no protocol call, and
 *      the strongest signal there is. Per-user by RLS (migration 0043), so this
 *      returns who YOU have written to and never a colleague's correspondents.
 *   2. **The extension registry** — Accounting's customers and vendors today,
 *      a CRM later, and Mail never learns which. Uses the caller's transaction,
 *      so it offers exactly the records that person may read.
 *   3. **The mail server's address book** — `ContactCard/query`, the shape of
 *      which came from `npm run mail:probe-contacts` rather than from the draft.
 *
 * `Promise.allSettled` rather than `all`: a directory that is slow or down must
 * cost its own rows, never the suggestions from the other two. An autocomplete
 * is an aid, and the recipient field has to keep working without it.
 */

type ActionResult<T> = { ok: true; data: T } | { error: string };

/** Enough to choose from without becoming a list somebody has to read. */
const LIMIT = 8;
/** Per source, before ranking merges and truncates them. */
const PER_SOURCE = 12;

export async function searchRecipientsAction(input: {
  mailboxId: string;
  query: string;
  /** Addresses already in To/Cc/Bcc, so nobody is offered twice. */
  chosen?: string[];
}): Promise<ActionResult<ContactSuggestion[]>> {
  try {
    const ctx = await requireTenant();
    await requireModuleEnabled(ctx.tenant.id, "email");
    if (ctx.role === "expert") {
      throw new MailError("FORBIDDEN_EXPERT", "accountant has no mail access");
    }

    const query = typeof input?.query === "string" ? input.query.trim().slice(0, 200) : "";
    // Nothing typed, nothing offered. Unlike the image picker, this fires while
    // somebody types an address — listing every customer the moment a recipient
    // field is focused would be a query per composer for suggestions nobody
    // asked for.
    if (query.length === 0) return { ok: true, data: [] };

    const account = await loadConnection(ctx.tenant.id, ctx.userId, input.mailboxId);
    if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");

    const [fromDatabase, fromDirectory] = await Promise.allSettled([
      // Both database sources share ONE transaction: they are two reads under
      // the same RLS context, and opening a second would double the connection
      // cost of every keystroke.
      withTenant(
        ctx.tenant.id,
        async (tx) => {
          const extensionCtx = {
            tenantId: ctx.tenant.id,
            userId: ctx.userId,
            role: ctx.role,
          };
          const [recent, records] = await Promise.all([
            recentCorrespondents(tx, ctx.tenant.id, query, PER_SOURCE),
            searchExtensionContacts(tx, extensionCtx, query, PER_SOURCE),
          ]);
          return [
            ...recent,
            ...records.map(
              (r): ContactSuggestion => ({
                email: r.email,
                name: r.name,
                sublabel: r.sublabel ?? "",
                origin: "records",
              }),
            ),
          ];
        },
        // BOTH are required. `userId` is what makes `mail_thread_index` return
        // this person's correspondents rather than nothing; `role` is what lets
        // an owner see records staff cannot.
        { role: ctx.role, userId: ctx.userId },
      ),
      directoryContacts(account, query),
    ]);

    const suggestions: ContactSuggestion[] = [
      ...(fromDatabase.status === "fulfilled" ? fromDatabase.value : []),
      ...(fromDirectory.status === "fulfilled" ? fromDirectory.value : []),
    ];
    if (fromDatabase.status === "rejected") {
      console.error("recipient suggestions: database sources failed", fromDatabase.reason);
    }

    const ranked = rankContacts(
      excludeChosen(suggestions, Array.isArray(input.chosen) ? input.chosen : []),
      query,
      LIMIT,
    );
    return { ok: true, data: ranked };
  } catch (err) {
    if (!(err instanceof MailError)) console.error("recipient search failed", err);
    return { error: friendlyMessage(err) };
  }
}

/**
 * The mail server's own address book.
 *
 * Swallows its own failures to an empty list rather than throwing: a server that
 * advertises the contacts capability and then refuses the method — which the
 * probe found is a real possibility, since this is a draft spec — must cost its
 * rows and nothing else.
 */
async function directoryContacts(
  account: Parameters<typeof authorizedClient>[0],
  query: string,
): Promise<ContactSuggestion[]> {
  try {
    const client = await authorizedClient(account);
    if (!client.ok) return [];
    const found = await client.data.searchContacts(query, PER_SOURCE);
    if (!found.ok) return [];
    return found.data.map((contact) => ({
      email: contact.email,
      name: contact.name,
      sublabel: contact.organization || "Address book",
      origin: "directory" as const,
    }));
  } catch {
    return [];
  }
}
