import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import type { MailAccount, MailAutofileRule } from "@/db/schema";
import { authorizedClient } from "@/lib/email/oauth/accounts";
import { logAudit } from "@/lib/audit";
import {
  enabledMailExtensions,
  filingTargetFor,
} from "@/lib/mail-extensions/resolve";
import { buildFiledMessage } from "../filing";
import { AUTOFILE_PAGE, advanceCursor, autofileFilter, skipReasonFor } from "./match";

/**
 * File the attachments that have arrived since last time.
 *
 * The automatic half of the attachments → Documents loop, which this dossier
 * has had open since the hosted-mailbox build. The manual half — somebody
 * attaches a thread to an invoice and the message is filed — has existed since
 * Slice 5, and this runs the SAME filing path from the cron instead of from a
 * click. Nothing about how a message becomes a document changes here; only who
 * decides that it should.
 *
 * **THE TRIGGER COULD ONLY EVER BE OUR OWN SYNC.** Every other organising
 * feature in this module pushes work down to the mail server — rules compile to
 * Sieve, snooze moves a message, labels are mailboxes — and none of that is
 * available here, because Sieve runs inside the mail server and has no way to
 * call Yosher. The one Sieve action that could reach us is `redirect` to an
 * inbound address, which would send the message back out over SMTP, duplicate
 * it, and break SPF on the way. So this rides the cron, and its latency is the
 * cron's cadence — the cost ADR 0005 already accepted and named.
 *
 * IT RUNS UNDER `withSystem`, the documented exception for trusted background
 * code, so RLS is not standing behind it: every read is pinned to the account
 * its own row names. The row itself is only writable by the person whose
 * mailbox it is (drizzle/0058), which is what makes that safe.
 *
 * **IT RUNS AS `staff`, AND THAT IS NOT A CHOICE.** `requireTenant()` derives
 * "owner" from Clerk's organization role, which a cron invocation has no
 * session to obtain — and AGENTS.md forbids passing a role that did not come
 * from a real context. So the least-privileged value is the only honest one,
 * and the consequence is worth stating plainly: **auto-filing can never reach
 * an owners-only folder.** The action refuses to create such a rule up front,
 * so this fails at the moment somebody chooses rather than silently every night.
 */

export interface AutofileOutcome {
  rules: number;
  filed: number;
  skipped: number;
  failed: number;
}

/**
 * Rules to consider this tick, oldest run first.
 *
 * Ordering by `last_run_at` with nulls first means a rule somebody has just
 * created is picked up on the next tick rather than queueing behind everything
 * else — which is when a person is most likely to be watching for it to work.
 */
async function dueRules(limit: number): Promise<MailAutofileRule[]> {
  return withSystem((tx) =>
    tx
      .select()
      .from(schema.mailAutofileRules)
      .where(eq(schema.mailAutofileRules.isEnabled, true))
      .orderBy(sql`${schema.mailAutofileRules.lastRunAt} asc nulls first`)
      .limit(limit),
  );
}

async function accountFor(rule: MailAutofileRule): Promise<MailAccount | null> {
  const [row] = await withSystem((tx) =>
    tx
      .select()
      .from(schema.mailAccounts)
      .where(
        and(
          eq(schema.mailAccounts.tenantId, rule.tenantId),
          eq(schema.mailAccounts.id, rule.mailAccountId),
        ),
      ),
  );
  return row ?? null;
}

async function recordRun(
  ruleId: string,
  values: { cursor: Date | null; filed: number; error: string },
): Promise<void> {
  await withSystem((tx) =>
    tx
      .update(schema.mailAutofileRules)
      .set({
        cursor: values.cursor,
        lastRunAt: new Date(),
        lastError: values.error.slice(0, 500),
        ...(values.filed > 0
          ? { filedCount: sql`${schema.mailAutofileRules.filedCount} + ${values.filed}` }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.mailAutofileRules.id, ruleId)),
  );
}

export async function runAutofileRules(limit: number): Promise<AutofileOutcome> {
  const rules = await dueRules(limit);
  if (rules.length === 0) return { rules: 0, filed: 0, skipped: 0, failed: 0 };

  let filed = 0;
  let skipped = 0;
  let failed = 0;

  // Resolved per TENANT rather than once: `enabledMailExtensions` answers
  // "which modules is this business paying for", and a tenant without Documents
  // has nowhere to file to. Cached across rules in the same tenant because the
  // sweep commonly picks up several, and the lookup is a database read.
  const filerFor = new Map<
    string,
    Awaited<ReturnType<typeof enabledMailExtensions>>[number] | null
  >();
  const resolveFiler = async (tenantId: string) => {
    if (!filerFor.has(tenantId)) {
      filerFor.set(tenantId, filingTargetFor(await enabledMailExtensions(tenantId)));
    }
    return filerFor.get(tenantId) ?? null;
  };

  for (const rule of rules) {
    try {
      const filer = await resolveFiler(rule.tenantId);
      if (!filer?.filing) {
        // Documents is switched off for this business. Not an error and not
        // worth retrying every minute — there is nowhere for a copy to go. The
        // run is recorded so the rule stops being picked first every tick.
        await recordRun(rule.id, {
          cursor: rule.cursor,
          filed: 0,
          error: "Documents is not switched on for this business.",
        });
        continue;
      }

      const account = await accountFor(rule);
      if (!account) {
        // The FK cascades, so this is a race with a disconnect rather than a
        // dangling row. Nothing to do and nothing to report.
        continue;
      }

      const client = await authorizedClient(account);
      if (!client.ok) {
        // A revoked grant or an expired token. Recorded on the rule so it is
        // visible in the editor rather than only in a log nobody reads, and the
        // cursor is left exactly where it was.
        await recordRun(rule.id, {
          cursor: rule.cursor,
          filed: 0,
          error: client.message,
        });
        failed += 1;
        continue;
      }

      const folders = await client.data.listMailboxes();
      if (!folders.ok) {
        await recordRun(rule.id, { cursor: rule.cursor, filed: 0, error: folders.message });
        failed += 1;
        continue;
      }
      const inbox = folders.data.find((f) => f.role === "inbox");
      if (!inbox) {
        await recordRun(rule.id, {
          cursor: rule.cursor,
          filed: 0,
          error: "this mailbox has no inbox",
        });
        failed += 1;
        continue;
      }

      const listed = await client.data.queryEmails({
        filter: autofileFilter(rule, inbox.id),
        // OLDEST FIRST, which is what makes the watermark safe. Newest-first
        // would advance the cursor past messages the page had not reached, and
        // they would never be looked at again.
        sort: [{ property: "receivedAt", isAscending: true }],
        limit: AUTOFILE_PAGE,
      });
      if (!listed.ok) {
        await recordRun(rule.id, { cursor: rule.cursor, filed: 0, error: listed.message });
        failed += 1;
        continue;
      }

      const ctx = {
        tenantId: rule.tenantId,
        userId: rule.clerkUserId,
        // See the file header: a cron cannot prove ownership, so the
        // least-privileged role is the only one it may claim.
        role: "staff" as const,
      };

      const done: (Date | null)[] = [];
      let filedHere = 0;
      let ruleError = "";

      for (const message of listed.data.emails) {
        // Decided on METADATA, before a byte of body or attachment is fetched.
        const skip = skipReasonFor(message, rule);
        if (skip) {
          skipped += 1;
          done.push(message.receivedAt);
          continue;
        }

        try {
          const built = await buildFiledMessage(
            client.data,
            message,
            rule.destinationFolderId
              ? { entityType: "folder", entityId: rule.destinationFolderId }
              : undefined,
          );
          const result = await filer.filing.fileMessage(ctx, built.input);

          if (!result.alreadyFiled) {
            filedHere += 1;
            filed += 1;
            // Audited per message, like the manual path — because this is the
            // same disclosure, with nobody watching it happen. Identifiers and
            // counts only: no subject, no sender, no file name (S9).
            await logAudit({
              action: "mail.message_autofiled",
              tenantId: rule.tenantId,
              actorClerkUserId: rule.clerkUserId,
              targetType: "document",
              targetId: result.entityId,
              meta: {
                ruleId: rule.id,
                mailAccountId: rule.mailAccountId,
                attachmentsFiled: result.attachmentsFiled,
                attachmentsRejected: result.attachmentsRejected,
                attachmentsSkipped: built.skipped,
              },
            });
          } else {
            skipped += 1;
          }
          done.push(message.receivedAt);
        } catch (err) {
          // ONE BAD MESSAGE STOPS THIS RULE'S PAGE, and does not advance past
          // it. The alternative — skipping it and moving the cursor on — loses
          // the document silently, which is the failure nobody would notice
          // until they went looking for a file that should have been there.
          ruleError =
            err instanceof Error ? err.message : "a message could not be filed";
          failed += 1;
          break;
        }
      }

      await recordRun(rule.id, {
        cursor: advanceCursor(rule.cursor, done),
        filed: filedHere,
        error: ruleError,
      });
    } catch (err) {
      // A rule that throws must not take the sweep down with it — the other
      // rules belong to other people.
      failed += 1;
      console.error("mail: autofile rule failed", rule.id, err);
    }
  }

  return { rules: rules.length, filed, skipped, failed };
}
