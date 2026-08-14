import "server-only";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import type { RecurringEntry } from "@/db/schema";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import { LedgerError, requireOwnerRole, type LedgerCtx } from "../core";
import { getSettings } from "../core/guards";
import { postEntry } from "../core/posting";
import { createBillDraft } from "../payables/bills";
import { createInvoiceDraft } from "../invoicing/invoices";
import { addDaysIso } from "../lib/dates";
import { todayInTimezone } from "../lib/money";
import { advanceMonthly } from "./schedule";
import {
  parseRecurringEntryTemplate,
  type RecurringEntryTemplate,
} from "./template";

/**
 * Everything a business books on a schedule: journals (the monthly
 * depreciation entry), bills (the rent that arrives every month whether or not
 * anybody sends a copy) and invoices (the same rent, from the other side).
 *
 * This loop started as the invoice-only `invoicing/recurring.ts` and was
 * rewritten kind-agnostic when a second recurrence appeared; the third folded
 * the original back INTO it, which is why the invoice branch reads like a
 * translation of that file. The hard-won parts were never invoice-specific:
 * one transaction PER TEMPLATE so a bad one never rolls back the others,
 * compare-and-swap on `version` so a double-click cannot double-generate, and
 * catch-up that creates one period-dated record per missed period rather than
 * one dated today.
 */

/** Missed periods one run will make up. Same bound as recurring invoices. */
const CATCH_UP_CAP = 12;

export interface RecurringEntryResult {
  /** Records created, drafts and postings together. */
  created: number;
  /** Of those, journals that actually posted to the ledger. */
  posted: number;
  /**
   * Runs that WANTED to post and landed as drafts because the period was
   * closed. Surfaced rather than swallowed: somebody has to know a
   * depreciation entry is sitting unposted.
   */
  deferredToDraft: number;
  templatesRun: number;
  errors: Array<{ recurringEntryId: string; name: string; error: string }>;
}

export async function listRecurringEntries(
  tx: Tx,
  tenantId: string,
): Promise<RecurringEntry[]> {
  return tx.query.recurringEntries.findMany({
    where: eq(schema.recurringEntries.tenantId, tenantId),
    orderBy: asc(schema.recurringEntries.name),
  });
}

/**
 * Prove the template still points at things that exist and are usable.
 *
 * Re-checked at generation because a template saved in March can reference an
 * account somebody deactivated in June. Failing the template with a reported
 * error is right; silently posting to a dead account is not.
 */
async function assertTemplateReferences(
  tx: Tx,
  tenantId: string,
  template: RecurringEntryTemplate,
): Promise<void> {
  // Each kind names its account differently: a journal line IS an account, an
  // invoice line points at income, and a bill line may be uncoded (P9).
  const accountIds =
    template.kind === "journal"
      ? template.lines.map((l) => l.accountId)
      : template.kind === "invoice"
        ? template.lines.map((l) => l.incomeAccountId)
        : template.lines
            .map((l) => l.accountId)
            .filter((id): id is string => id !== null && id !== undefined);
  if (accountIds.length === 0) return;

  const found = await tx
    .select({ id: schema.accounts.id, isActive: schema.accounts.isActive })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.tenantId, tenantId),
        inArray(schema.accounts.id, [...new Set(accountIds)]),
      ),
    );
  const usable = new Set(found.filter((a) => a.isActive).map((a) => a.id));
  for (const id of accountIds) {
    if (!usable.has(id)) {
      throw new LedgerError(
        "ACCOUNT_INACTIVE",
        "the template references an account that is missing or inactive",
      );
    }
  }
}

/**
 * Run every template that is due.
 *
 * `now` is not injectable here — the tenant's own clock decides, through
 * `todayInTimezone`, the same way the reminder sweep and the close screen do.
 */
export async function generateRecurringEntries(
  ctx: LedgerCtx,
  options: { unattended?: boolean } = {},
): Promise<RecurringEntryResult> {
  requireOwnerRole(ctx);

  const { due, today, closedThrough } = await withTenant(ctx.tenantId, async (tx) => {
    const today = todayInTimezone(await getTenantTimezone(tx, ctx.tenantId));
    const settings = await getSettings(tx, ctx.tenantId);
    const due = await tx.query.recurringEntries.findMany({
      where: and(
        eq(schema.recurringEntries.tenantId, ctx.tenantId),
        eq(schema.recurringEntries.isActive, true),
        lte(schema.recurringEntries.nextRunDate, today),
      ),
    });
    return { due, today, closedThrough: settings.closedThrough };
  });

  const result: RecurringEntryResult = {
    created: 0,
    posted: 0,
    deferredToDraft: 0,
    templatesRun: 0,
    errors: [],
  };

  for (const entry of due) {
    /**
     * WHO the generated records belong to.
     *
     * When somebody presses Generate now, it is them. On the nightly sweep
     * there is nobody at the keyboard, so the records are attributed to
     * whoever WROTE THE SCHEDULE DOWN — which is the truthful answer, and the
     * only person who ever decided any of this. `created_by_clerk_user_id` is
     * NOT NULL on all three targets, so it needs a real id rather than a
     * sentinel; using the template's author also means the History panel names
     * a person who can explain the row, instead of "A teammate".
     */
    const actor: LedgerCtx = options.unattended
      ? { ...ctx, userId: entry.createdByClerkUserId }
      : ctx;
    try {
      const outcome = await withTenant(ctx.tenantId, async (tx) => {
        const template = parseRecurringEntryTemplate(entry.template);
        if (!template) {
          throw new LedgerError(
            "RECURRING_TEMPLATE_INVALID",
            "template shape invalid, or a journal that no longer balances",
          );
        }
        if (template.kind !== entry.kind) {
          throw new LedgerError(
            "RECURRING_TEMPLATE_INVALID",
            "template kind disagrees with the row's kind",
          );
        }
        await assertTemplateReferences(tx, ctx.tenantId, template);

        let next = entry.nextRunDate;
        let runs = 0;
        let posted = 0;
        let deferred = 0;

        while (next <= today && runs < CATCH_UP_CAP) {
          if (template.kind === "journal") {
            /**
             * A RULE NEVER OVERRIDES THE PERIOD LOCK. An auto-posting template
             * whose run date falls in a closed period lands as a DRAFT instead
             * — the same choice bank rules make, and for the same reason:
             * refusing the run entirely would silently stop the schedule, and
             * posting into a closed period would break the close.
             */
            const inClosedPeriod = closedThrough !== null && next <= closedThrough;
            const wantsPost = entry.autoPost;
            const status = wantsPost && !inClosedPeriod ? "posted" : "draft";
            if (wantsPost && inClosedPeriod) deferred += 1;

            await postEntry(tx, actor, {
              status,
              entryDate: next,
              memo: template.memo ?? entry.name,
              lines: template.lines.map((l) => ({
                accountId: l.accountId,
                amountCents: l.amountCents,
                ...(l.memo ? { memo: l.memo } : {}),
                ...(l.dimensionMemberIds
                  ? { dimensionMemberIds: l.dimensionMemberIds }
                  : {}),
              })),
              // Stable per (template, period): a re-run cannot double-post the
              // same month even if the version CAS is somehow beaten.
              idempotencyKey: `recurring:${entry.id}:${next}`,
            });
            if (status === "posted") posted += 1;
          } else if (template.kind === "invoice") {
            // Invoices are ALWAYS drafts too, and always were: a human reviews
            // before AR posts, and generation never touches the ledger, which
            // is what makes it immune to PERIOD_CLOSED. That rule came with
            // `recurring_invoices` and survives the move unchanged.
            await createInvoiceDraft(tx, actor, {
              customerId: entry.customerId!,
              issueDate: next,
              dueDate: addDaysIso(next, template.dueInDays),
              memo: template.memo ?? entry.name,
              lines: template.lines,
              // Re-resolved against the live rate every month by
              // `createInvoiceDraft`, which is the point: a template says
              // "charge the state rate", and a rate correction should reach
              // the invoice it has not generated yet. A rate deactivated since
              // the template was written throws TAX_RATE_INVALID, which the
              // loop reports against this template and carries on — the same
              // treatment an inactive account already gets.
              taxRateId: template.taxRateId ?? null,
              recurringEntryId: entry.id,
            });
          } else {
            // Bills are ALWAYS drafts. Approving a bill is what posts it, and
            // that approval is the control an owner already exercises over
            // money going out — generating an approved bill would remove it.
            await createBillDraft(tx, actor, {
              vendorId: entry.vendorId!,
              billDate: next,
              dueDate: addDaysIso(next, template.dueInDays),
              memo: template.memo ?? entry.name,
              lines: template.lines,
            });
          }
          next = advanceMonthly(next, entry.dayOfMonth);
          runs += 1;
        }

        const rows = await tx
          .update(schema.recurringEntries)
          .set({
            nextRunDate: next,
            lastGeneratedAt: new Date(),
            version: entry.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.recurringEntries.tenantId, ctx.tenantId),
              eq(schema.recurringEntries.id, entry.id),
              eq(schema.recurringEntries.version, entry.version),
            ),
          )
          .returning();
        if (rows.length === 0) {
          // Somebody else generated concurrently — roll this template back
          // whole, rather than leaving half a month's entries behind.
          throw new LedgerError("STALE_VERSION", "template generated concurrently");
        }
        return { runs, posted, deferred };
      });

      result.created += outcome.runs;
      result.posted += outcome.posted;
      result.deferredToDraft += outcome.deferred;
      result.templatesRun += 1;
    } catch (err) {
      result.errors.push({
        recurringEntryId: entry.id,
        name: entry.name,
        error: err instanceof LedgerError ? err.code : "UNKNOWN",
      });
    }
  }

  return result;
}
