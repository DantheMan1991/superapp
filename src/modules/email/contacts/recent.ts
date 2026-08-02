import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { MailParticipant } from "@/db/schema";
import type { ContactSuggestion } from "./rank";

/**
 * People this person has actually corresponded with.
 *
 * THE BEST SOURCE OF THE THREE, and it costs no protocol call at all — it reads
 * `mail_thread_index`, which sync already maintains so a module can ask "every
 * thread on this invoice" without N+1 round trips. The participants column was
 * put there for display; this is a second use for data already on hand.
 *
 * PER-USER BY RLS, and that is not incidental. `mail_thread_index` is scoped on
 * `app.clerk_user_id` through its `mail_accounts` EXISTS (migration 0043), so
 * this returns the addresses YOU have written to and never a colleague's. An
 * autocomplete that leaked who somebody else corresponds with would be a
 * privacy failure wearing a convenience feature's clothes — the reason that
 * policy exists in the first place is that a subject line in a colleague's
 * thread list is already a leak.
 *
 * The caller must therefore pass `{ userId }` to `withTenant`; without it the
 * policy matches nothing and this silently returns empty. That is the
 * fail-closed direction, deliberately.
 */
/**
 * A LIKE pattern, with the wildcards a user typed escaped.
 *
 * Same helper as the Documents and Accounting extensions carry. Without it a
 * bare `%` matches everything, so typing one into a recipient field would offer
 * every address in the index — and `_` would quietly match any character.
 */
function contains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function recentCorrespondents(
  tx: Tx,
  tenantId: string,
  query: string,
  limit: number,
): Promise<ContactSuggestion[]> {
  const term = query.trim();
  if (term.length === 0) return [];

  /**
   * Filtered in SQL on the raw jsonb TEXT before parsing.
   *
   * A crude containment test, deliberately: the participants column is a jsonb
   * array of `{name, email}`, and an exact jsonb path query would need one
   * predicate per field while this narrows thousands of threads to a handful
   * that are then filtered properly in code. Being over-inclusive here costs
   * nothing — `rankContacts` drops anything that does not really match.
   */
  const rows = await tx
    .select({
      participants: schema.mailThreadIndex.participants,
      lastMessageAt: schema.mailThreadIndex.lastMessageAt,
    })
    .from(schema.mailThreadIndex)
    .where(
      and(
        eq(schema.mailThreadIndex.tenantId, tenantId),
        sql`${schema.mailThreadIndex.participants}::text ilike ${contains(term)}`,
      ),
    )
    .orderBy(desc(schema.mailThreadIndex.lastMessageAt))
    // Threads, not people: one correspondent can own many, so this is scanned
    // well above the number of suggestions wanted.
    .limit(Math.max(limit * 20, 200));

  const seen = new Set<string>();
  const out: ContactSuggestion[] = [];
  for (const row of rows) {
    const participants = Array.isArray(row.participants)
      ? (row.participants as MailParticipant[])
      : [];
    for (const participant of participants) {
      const email = (participant?.email ?? "").trim();
      if (email.length === 0) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        email,
        name: (participant?.name ?? "").trim(),
        sublabel: describeWhen(row.lastMessageAt),
        origin: "recent",
      });
      // Rows arrive newest-first, so the first sighting of an address is its
      // most recent one and there is no reason to keep scanning for it.
      if (out.length >= limit * 4) return out;
    }
  }
  return out;
}

/**
 * "Emailed last week".
 *
 * Deliberately vague rather than a date. The useful thing is WHY this is being
 * suggested — you have written to them — and an exact timestamp on an
 * autocomplete row is noise that makes the list harder to scan.
 */
function describeWhen(at: Date | null): string {
  if (!at) return "Emailed before";
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (days <= 1) return "Emailed today";
  if (days < 7) return "Emailed this week";
  if (days < 31) return "Emailed this month";
  if (days < 366) return "Emailed this year";
  return "Emailed before";
}
