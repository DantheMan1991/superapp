import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import { schema, withSystem, withTenant } from "@/db";
import {
  collectAttention,
  sortAttention,
} from "@/lib/attention-sources/resolve";
import type { AttentionItem } from "@/lib/attention-sources/types";

/**
 * Assembling one person's digest.
 *
 * The collection itself is `collectAttention` — the same call the in-app page
 * makes, deliberately, because "one number everywhere" is not a convention to
 * be remembered but a consequence of there being one function. What this file
 * adds is the DELTA, which is what makes the mail readable on day 30 rather
 * than wallpaper by day 5.
 */

export interface DigestDelta {
  /** Keys present today that were not in the last digest sent. */
  newKeys: string[];
  /** Keys present today that were also in the last one. */
  carriedKeys: string[];
  /** True when there is no previous digest to compare against. */
  first: boolean;
}

export interface PersonDigest {
  tenantId: string;
  profileId: string;
  clerkUserId: string;
  email: string;
  name: string | null;
  role: "owner" | "staff" | "expert";
  /** The tenant-local date this digest is FOR. */
  localDate: string;
  items: AttentionItem[];
  delta: DigestDelta;
  /** Sources that could not be asked. Non-empty means the count is a floor. */
  failed: Array<{ slug: string; label: string }>;
  complete: boolean;
}

/**
 * Compare today's items against the last digest actually SENT to this person.
 *
 * Against the last one sent, not against yesterday's date: somebody who had
 * nothing on Tuesday, or whose Tuesday send failed, should not have every item
 * described as "new" on Wednesday merely because a row is missing. The
 * comparison that means something to a reader is "since the last time I told
 * you", which is exactly what the log records.
 */
export function computeDelta(
  todayKeys: readonly string[],
  previousKeys: readonly string[] | null,
): DigestDelta {
  if (previousKeys === null) {
    return { newKeys: [...todayKeys], carriedKeys: [], first: true };
  }
  const seen = new Set(previousKeys);
  const newKeys: string[] = [];
  const carriedKeys: string[] = [];
  for (const key of todayKeys) {
    if (seen.has(key)) carriedKeys.push(key);
    else newKeys.push(key);
  }
  return { newKeys, carriedKeys, first: false };
}

/** Item keys from the most recent digest sent to this person before `before`. */
async function previousKeysFor(
  tenantId: string,
  profileId: string,
  before: string,
): Promise<string[] | null> {
  // withSystem, justified (S2): trusted background code, and the log has no
  // member policy by design (drizzle/0090). The ids come from the roster this
  // run already resolved, never from a request.
  const row = await withSystem((tx) =>
    tx.query.notificationDigestLog.findFirst({
      where: and(
        eq(schema.notificationDigestLog.tenantId, tenantId),
        eq(schema.notificationDigestLog.profileId, profileId),
        lt(schema.notificationDigestLog.localDate, before),
      ),
      orderBy: desc(schema.notificationDigestLog.localDate),
    }),
  );
  if (!row) return null;
  const keys = row.itemKeys;
  // jsonb is `unknown` as far as the type system is concerned, and this row
  // was written by an older version of this code. Anything unexpected is
  // treated as "no previous digest", which degrades to calling everything new
  // — noisier, never wrong.
  if (!Array.isArray(keys)) return null;
  return keys.filter((k): k is string => typeof k === "string");
}

/**
 * Build the digest for one person.
 *
 * Runs inside `withTenant` with THAT PERSON'S role and user id, so every source
 * sees exactly what they would see in the app. The role comes from the
 * membership row the caller has already reconciled against Clerk — see
 * `membership-sync.ts` for why a background job may not simply trust a stored
 * role.
 */
export async function buildPersonDigest(person: {
  tenantId: string;
  profileId: string;
  clerkUserId: string;
  email: string;
  name: string | null;
  role: "owner" | "staff" | "expert";
  localDate: string;
}): Promise<PersonDigest> {
  const result = await withTenant(
    person.tenantId,
    (tx) =>
      collectAttention(tx, {
        tenantId: person.tenantId,
        userId: person.clerkUserId,
        role: person.role,
        today: person.localDate,
      }),
    { role: person.role, userId: person.clerkUserId },
  );

  const items = sortAttention(result.items);
  const previous = await previousKeysFor(
    person.tenantId,
    person.profileId,
    person.localDate,
  );

  return {
    ...person,
    items,
    delta: computeDelta(
      items.map((i) => i.key),
      previous,
    ),
    failed: result.failed.map((f) => ({ slug: f.slug, label: f.label })),
    complete: result.complete,
  };
}

/**
 * Record that this digest went out.
 *
 * Returns false when a row already existed, which is the idempotency answer:
 * two overlapping cron invocations both reach here and exactly one wins the
 * unique index. The caller must send only on `true`.
 *
 * Deliberately written BEFORE the email rather than after. If the insert wins
 * and the send then fails, the person misses one morning; if the send wins and
 * the insert then fails, the retry mails them again. Between "occasionally
 * silent" and "occasionally duplicated", silence is the one that does not
 * teach people to ignore the channel.
 */
export async function claimDigestSend(input: {
  tenantId: string;
  profileId: string;
  localDate: string;
  itemKeys: string[];
}): Promise<boolean> {
  // withSystem, justified (S2): trusted background code writing a table with
  // no member policy. Ids come from the reconciled roster, never a request.
  const inserted = await withSystem((tx) =>
    tx
      .insert(schema.notificationDigestLog)
      .values({
        tenantId: input.tenantId,
        profileId: input.profileId,
        localDate: input.localDate,
        itemCount: input.itemKeys.length,
        itemKeys: input.itemKeys,
      })
      .onConflictDoNothing({
        target: [
          schema.notificationDigestLog.tenantId,
          schema.notificationDigestLog.profileId,
          schema.notificationDigestLog.localDate,
        ],
      })
      .returning({ id: schema.notificationDigestLog.id }),
  );
  return inserted.length > 0;
}
