import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { MailError } from "../core/errors";
import {
  isEmptyView,
  parseMailView,
  type MailViewQuery,
} from "./filters";

/**
 * Named mail views, stored per person.
 *
 * The design is the one Documents' saved views settled: **a saved search does
 * not carry its own query engine.** The stored blob is re-parsed into the same
 * `MailViewQuery` the URL produces, and the existing list view runs. Here that
 * property is stronger than it is in Documents, because mail search executes on
 * the MAIL SERVER — the blob becomes a JMAP filter and has no path to SQL even
 * in principle.
 *
 * Every function takes the caller's `tx`, and every read must be under
 * `withTenant(..., { userId })` — the policy in `0048` scopes rows to one
 * person, so forgetting it returns nothing rather than a colleague's searches.
 */

export const SAVED_SEARCHES_MAX = 20;
const NAME_MAX = 60;

export function searchNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface SavedSearchEntry {
  id: string;
  name: string;
  query: MailViewQuery;
  /** The view as a link — the whole point. */
  href: string;
}

const BASE = "/dashboard/m/email";

/** A stored view as a URL. The inverse of `readMailView`. */
export function savedSearchHref(query: MailViewQuery): string {
  const params = new URLSearchParams();
  if (query.mailbox) params.set("mailbox", query.mailbox);
  if (query.q) params.set("q", query.q);
  if (query.unread) params.set("unread", "1");
  if (query.flagged) params.set("flagged", "1");
  if (query.attach) params.set("attach", "1");
  const qs = params.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}

export async function listSavedSearches(
  tx: Tx,
  tenantId: string,
  mailAccountId: string,
): Promise<SavedSearchEntry[]> {
  const rows = await tx
    .select()
    .from(schema.mailSavedSearches)
    .where(
      and(
        eq(schema.mailSavedSearches.tenantId, tenantId),
        eq(schema.mailSavedSearches.mailAccountId, mailAccountId),
      ),
    )
    .orderBy(
      asc(schema.mailSavedSearches.sortOrder),
      asc(schema.mailSavedSearches.name),
    );

  // No clerkUserId predicate: the policy in 0048 is what scopes this, and
  // adding one here would suggest the app is the control when it is not.
  return rows.map((row) => {
    const query = parseMailView(row.query);
    return {
      id: row.id,
      name: row.name,
      query,
      href: savedSearchHref(query),
    };
  });
}

export async function createSavedSearch(
  tx: Tx,
  ctx: { tenantId: string; userId: string },
  input: { mailAccountId: string; name: string; query: MailViewQuery },
): Promise<SavedSearchEntry> {
  const name = input.name.trim().slice(0, NAME_MAX);
  if (name.length === 0) throw new MailError("SEARCH_NAME_INVALID", "blank name");

  // Parsed on the way IN as well as out: the column should never hold a shape
  // this module would refuse to read back.
  const query = parseMailView(input.query);
  if (isEmptyView(query)) {
    // A saved search that selects everything is a folder, and there is already
    // a rail full of those.
    throw new MailError("SEARCH_QUERY_EMPTY", "no filters");
  }

  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.mailSavedSearches)
    .where(
      and(
        eq(schema.mailSavedSearches.tenantId, ctx.tenantId),
        eq(schema.mailSavedSearches.mailAccountId, input.mailAccountId),
      ),
    );
  if (count >= SAVED_SEARCHES_MAX) {
    throw new MailError("SEARCH_LIMIT", `${count} saved`);
  }

  const inserted = await tx
    .insert(schema.mailSavedSearches)
    .values({
      tenantId: ctx.tenantId,
      clerkUserId: ctx.userId,
      mailAccountId: input.mailAccountId,
      name,
      nameKey: searchNameKey(name),
      query,
    })
    .onConflictDoNothing()
    .returning();

  // The unique is (tenant, user, account, name_key), so a clash is only ever
  // with one of the caller's OWN searches — never a colleague's.
  if (inserted.length === 0) {
    throw new MailError("SEARCH_NAME_TAKEN", `name ${name} exists`);
  }

  const row = inserted[0];
  return {
    id: row.id,
    name: row.name,
    query,
    href: savedSearchHref(query),
  };
}

export async function deleteSavedSearch(
  tx: Tx,
  tenantId: string,
  searchId: string,
): Promise<{ name: string }> {
  // No ownership check in the application: RLS already scoped the delete to the
  // caller's own rows, so a colleague's id matches nothing. A miss means gone or
  // never theirs, and those are the same answer.
  const deleted = await tx
    .delete(schema.mailSavedSearches)
    .where(
      and(
        eq(schema.mailSavedSearches.tenantId, tenantId),
        eq(schema.mailSavedSearches.id, searchId),
      ),
    )
    .returning({ name: schema.mailSavedSearches.name });
  if (deleted.length === 0) {
    throw new MailError("SEARCH_NOT_FOUND", searchId);
  }
  return { name: deleted[0].name };
}
