import "server-only";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import type { RecurringEntry } from "@/db/schema";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import {
  LedgerError,
  assertCodableAccounts,
  loadDimensionMembers,
  requireOwnerRole,
  type LedgerCtx,
} from "../core";
import { loadCustomer } from "../invoicing/customers";
import { loadVendor } from "../payables/vendors";
import { getDefaultEntityId, listEntities } from "../core/entities";
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
  /**
   * Records ACTUALLY WRITTEN, drafts and postings together.
   *
   * **Not the number of periods the loop walked**, which is what this used to
   * report. `postEntry` is idempotent on `recurring:<templateId>:<date>` and
   * returns `deduped` when it hands back an entry it did not write — a signal
   * `createEntry` already checks before writing its audit row, and this loop
   * ignored. A deduped month was counted as created, and if it wanted to post,
   * as posted too.
   *
   * It is not reachable through the schedule today: `advanceMonthly` only ever
   * moves forward, the one backward writer of `next_run_date`
   * (`updateRecurringEntry`) refuses a move over months already generated, and
   * nothing else emits that key prefix. It is fixed anyway, because a count whose
   * correctness rests on an unreachability argument is one that goes wrong the
   * first time somebody makes it reachable — and this is the figure an operator
   * reasons from when a sweep looks wrong.
   */
  created: number;
  /** Of those, journals that actually posted to the ledger. */
  posted: number;
  /**
   * Runs that WANTED to post and landed as drafts because the period was
   * closed. Surfaced rather than swallowed: somebody has to know a
   * depreciation entry is sitting unposted.
   */
  deferredToDraft: number;
  /**
   * Periods the catch-up loop walked, whether or not each wrote anything.
   *
   * **`periodsWalked - created` is the number of months that were already
   * there** — never the other way round, since `created` can only increment
   * once per period and `runs` increments every time. The two are equal in
   * every ordinary run, and a gap is the only evidence a dedupe happened.
   *
   * **It is also the honest test for "was anything due at all".** `created`
   * used to answer that, exactly, because it WAS the period count; gating the
   * counters on `deduped` broke that equivalence, so the emptiness question
   * moved here with it.
   */
  periodsWalked: number;
  /**
   * Members a template still names that have since been RETIRED. Their tags
   * are dropped so the entry generates anyway — see `retiredMemberIds` — and
   * counted here for the same reason `deferredToDraft` is: it ran, but not the
   * way the template asked, and somebody has to be able to find out.
   *
   * **DISTINCT MEMBERS PER TEMPLATE**, counted once above the catch-up loop.
   * Not per line and not per month: one retired paddock, named on three lines
   * of a template that is twelve months behind, is ONE stale tag to go and
   * fix. Counting the writes instead would report 36 and mean nothing.
   */
  tagsDropped: number;
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
 * Prove the template points at accounts that exist, are active, and — for a
 * bill or an invoice — may be picked by hand.
 *
 * **CALLED AT SAVE AND AGAIN AT GENERATION, and the save-time call is the one
 * that was missing.** Until 2026-09-01 `createRecurringEntryAction` validated
 * the template's SHAPE and nothing else: any uuid passed as an account, and the
 * first anybody heard of it was an error row in a 6am sweep that no screen
 * shows and no column keeps. That is the failure mode `journalTemplateBalances`
 * was written to avoid — *"the same rule enforced where somebody is looking at
 * it"* — and the account rule gets the same treatment now.
 *
 * Re-checked at generation because a template saved in March can reference an
 * account somebody deactivated in June, or turned into a bank register in
 * July. Failing the template with a reported error is right; silently posting
 * to a dead account, or revenue to Checking, is not.
 *
 * **A JOURNAL TEMPLATE MAY NAME ANY ACCOUNT**, exactly as the hand-written
 * journal may — `isCodableAccount` says so and why. It gets the exists-and-
 * active check only.
 */
export async function assertTemplateReferences(
  tx: Tx,
  tenantId: string,
  template: RecurringEntryTemplate,
): Promise<void> {
  if (template.kind === "journal") {
    const accountIds = [...new Set(template.lines.map((l) => l.accountId))];
    const found = await tx
      .select({ id: schema.accounts.id, isActive: schema.accounts.isActive })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.tenantId, tenantId),
          inArray(schema.accounts.id, accountIds),
        ),
      );
    const byId = new Map(found.map((a) => [a.id, a]));
    for (const id of accountIds) {
      const row = byId.get(id);
      if (!row) throw new LedgerError("ACCOUNT_NOT_FOUND", `account ${id}`);
      if (!row.isActive) throw new LedgerError("ACCOUNT_INACTIVE", `account ${id}`);
    }
    return;
  }
  // An invoice line points at income; a bill line may be uncoded (P9).
  const accountIds =
    template.kind === "invoice"
      ? template.lines.map((l) => l.incomeAccountId)
      : template.lines
          .map((l) => l.accountId)
          .filter((id): id is string => id !== null && id !== undefined);
  await assertCodableAccounts(tx, tenantId, accountIds);
}

/** What the create action hands the op — the Zod-proved shape, structurally. */
export interface NewRecurringEntryInput {
  name: string;
  vendorId?: string | null;
  customerId?: string | null;
  dayOfMonth: number;
  nextRunDate: string;
  autoPost?: boolean;
  template: RecurringEntryTemplate;
}

/**
 * **SAVE A TEMPLATE, HAVING PROVED ITS ACCOUNTS FIRST.**
 *
 * Lifted out of `createRecurringEntryAction` on the day the account check was
 * added there, because an action sits behind `gate()` and Clerk and no test can
 * reach it — so nothing could prove the one line the change was about. An op
 * is the shape every other write in this module already has, and this is the
 * op. The action keeps what an action owns: the gate, the owner check, the
 * Zod, and the audit row.
 */
export async function createRecurringEntry(
  tx: Tx,
  ctx: LedgerCtx,
  input: NewRecurringEntryInput,
): Promise<RecurringEntry> {
  // Zod proved the SHAPE; this proves the ids name accounts a line may
  // actually be coded to, so a bad template is refused here with a sentence
  // rather than failing at 6am with nothing to show for it.
  await assertTemplateReferences(tx, ctx.tenantId, input.template);
  await assertTemplateSaveable(tx, ctx.tenantId, input);
  const [created] = await tx
    .insert(schema.recurringEntries)
    .values({
      tenantId: ctx.tenantId,
      kind: input.template.kind,
      name: input.name,
      vendorId: input.vendorId ?? null,
      customerId: input.customerId ?? null,
      template: input.template,
      dayOfMonth: input.dayOfMonth,
      nextRunDate: input.nextRunDate,
      autoPost: input.autoPost === true,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return created;
}

/**
 * **WHAT ONLY A SAVE CAN CHECK, checked at save.** Everything here is
 * something a person is choosing in the dialog right now, and each one used
 * to surface only at 6am:
 *
 * - the party is active for the kind (`VENDOR_INACTIVE` / `CUSTOMER_INACTIVE`
 *   were sweep-only errors — the composite FK proves existence, not activity);
 * - every tag names an active member. **Deliberately NOT in
 *   `assertTemplateReferences`**, which runs at generation, where #338 chose
 *   to DROP a retired tag rather than fail the template. A save is the one
 *   moment somebody can see the tag and take it off, so a save that still
 *   names it is refused, exactly as the invoice and bill edit pages refuse;
 * - a tax rate the template names is still active;
 * - a company the template names still exists and is active.
 */
export async function assertTemplateSaveable(
  tx: Tx,
  tenantId: string,
  input: {
    vendorId?: string | null;
    customerId?: string | null;
    template: RecurringEntryTemplate;
  },
): Promise<void> {
  const { template } = input;
  if (template.kind === "bill" && input.vendorId) {
    const vendor = await loadVendor(tx, tenantId, input.vendorId);
    if (!vendor.isActive) {
      throw new LedgerError("VENDOR_INACTIVE", `vendor ${vendor.id} inactive`);
    }
  }
  if (template.kind === "invoice" && input.customerId) {
    const customer = await loadCustomer(tx, tenantId, input.customerId);
    if (!customer.isActive) {
      throw new LedgerError("CUSTOMER_INACTIVE", `customer ${customer.id} inactive`);
    }
  }
  await loadDimensionMembers(
    tx,
    tenantId,
    template.lines as ReadonlyArray<{ dimensionMemberIds?: string[] }>,
  );
  if (template.kind === "invoice" && template.taxRateId) {
    const rate = await tx.query.salesTaxRates.findFirst({
      where: and(
        eq(schema.salesTaxRates.tenantId, tenantId),
        eq(schema.salesTaxRates.id, template.taxRateId),
      ),
      columns: { isActive: true },
    });
    if (!rate || !rate.isActive) {
      throw new LedgerError("TAX_RATE_INVALID", `tax rate ${template.taxRateId}`);
    }
  }
  if (template.entityId) {
    const entity = await tx.query.entities.findFirst({
      where: and(
        eq(schema.entities.tenantId, tenantId),
        eq(schema.entities.id, template.entityId),
      ),
      columns: { isActive: true },
    });
    if (!entity) throw new LedgerError("ENTITY_NOT_FOUND", `entity ${template.entityId}`);
    if (!entity.isActive) {
      throw new LedgerError("ENTITY_INACTIVE", `entity ${template.entityId}`);
    }
  }
}

export interface UpdateRecurringEntryInput extends NewRecurringEntryInput {
  id: string;
  expectedVersion: number;
}

/**
 * **CORRECT A STANDING INSTRUCTION.** Full replace of what the dialog holds,
 * under a compare-and-swap on `version`.
 *
 * Until 2026-09-01 there was no update path of any kind: a wrong amount, a
 * retired tag, a mis-coded account or a typo in the name meant pause it and
 * write a new one — and after a failure note landed on the row (the same
 * day's earlier PR) there was, for the first time, something visible to
 * correct and no way to correct it.
 *
 * **`kind` IS FROZEN.** The database ties party to kind and `invoices` points
 * back at an invoice template; changing what a schedule produces is a new
 * schedule. Party is editable WITHIN the kind. `isActive` is not in the SET —
 * `setActive` stays its one writer. `createdByClerkUserId` is unchanged; the
 * audit row names the editor.
 *
 * **THE NEXT RUN CANNOT MOVE BACK OVER MONTHS ALREADY GENERATED.** Invoice and
 * bill generation carry no idempotency key — they always insert — and a
 * journal's key is per (template, date), which a changed day-of-month defeats.
 * So a `next_run_date` moved from October back to June would make the next
 * sweep create four more invoices for months already invoiced. A template
 * that has never run may be re-dated freely. Forward moves stay allowed —
 * and a pause does NOT do the same thing, because a resume catches up rather
 * than skips; a forward edit is precisely how a month is skipped on purpose.
 *
 * **THE FRONTIER THIS COMPARES AGAINST IS `next_run_date`, AND THAT IS ONLY
 * THE WALKED FRONTIER WHILE THE SWEEP IS ITS SOLE WRITER — which this op ends.**
 * After a FORWARD edit the stored date is a person's choice, and a later move
 * back toward the months that really were generated is refused with a message
 * that is false ("they would be created again" — nothing between the true
 * frontier and the typed date ever was). The safe direction is preserved: no
 * double generation is possible. The correction path is a one-way ratchet
 * until the sweep records its own frontier in a column of its own
 * (`generated_through`, written only by the success UPDATE) — an additive
 * migration, and the named follow-up in the dossier. Bills carry no back-link,
 * so it cannot be derived from generated rows.
 *
 * **A FAILURE NOTE SURVIVES AN EDIT** — deliberately. A save-time check cannot
 * see a closed period, a re-typed account or a retired tax rate, so "edited"
 * is not "fixed". Only the template's next clean run clears it.
 */
export async function updateRecurringEntry(
  tx: Tx,
  ctx: LedgerCtx,
  input: UpdateRecurringEntryInput,
): Promise<{ before: RecurringEntry; after: RecurringEntry }> {
  const before = await tx.query.recurringEntries.findFirst({
    where: and(
      eq(schema.recurringEntries.tenantId, ctx.tenantId),
      eq(schema.recurringEntries.id, input.id),
    ),
  });
  if (!before) {
    throw new LedgerError("RECURRING_NOT_FOUND", `recurring entry ${input.id}`);
  }
  if (input.template.kind !== before.kind) {
    throw new LedgerError(
      "RECURRING_TEMPLATE_INVALID",
      "a schedule's kind is fixed — write a new one to change what it produces",
    );
  }
  // The same parse the sweep does, so save and sweep agree on what a valid
  // template is — a journal that no longer balances is refused here, not at 6am.
  if (!parseRecurringEntryTemplate(input.template)) {
    throw new LedgerError(
      "RECURRING_TEMPLATE_INVALID",
      "template shape invalid, or a journal that does not balance",
    );
  }
  await assertTemplateReferences(tx, ctx.tenantId, input.template);
  await assertTemplateSaveable(tx, ctx.tenantId, input);
  /**
   * **BY MONTH, NOT BY DAY.** `advanceMonthly` steps exactly one calendar
   * month, so the last generated period is always the month BEFORE the stored
   * `next_run_date`'s month, and every day of that month is ungenerated.
   * Comparing whole dates refused the most ordinary edit there is — "move the
   * rent from the 4th to the 1st" — with a sentence claiming September would
   * be created again when it never had been. Found by the adversarial pass.
   */
  if (
    before.lastGeneratedAt !== null &&
    input.nextRunDate.slice(0, 7) < before.nextRunDate.slice(0, 7)
  ) {
    throw new LedgerError(
      "RECURRING_SCHEDULE_BACKWARD",
      `next run ${input.nextRunDate} is before the walked frontier ${before.nextRunDate}`,
    );
  }

  const rows = await tx
    .update(schema.recurringEntries)
    .set({
      name: input.name,
      vendorId: input.vendorId ?? null,
      customerId: input.customerId ?? null,
      template: input.template,
      dayOfMonth: input.dayOfMonth,
      nextRunDate: input.nextRunDate,
      autoPost: input.autoPost === true,
      version: input.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.recurringEntries.tenantId, ctx.tenantId),
        eq(schema.recurringEntries.id, input.id),
        eq(schema.recurringEntries.version, input.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "recurring entry changed since loaded");
  }
  return { before, after: rows[0] };
}

/**
 * **LEAVE THE NOTE ON THE ROW.**
 *
 * Called after a template's own transaction has rolled back — which is why it
 * cannot ride inside it, and why it opens a transaction of its own, the way
 * the autofile sweep's `recordRun` does.
 *
 * **CAS'D ON THE VERSION THE SWEEP LOADED, AND THE VERSION IS NOT BUMPED.**
 * Zero rows means somebody else moved the row between the due load and now —
 * a concurrent success, or after editing exists, a save — and a stale note
 * must not overwrite what they did. Not bumping is what lets a Pause pressed
 * on a page opened before 6am still land: the row's version is unchanged by a
 * failure, so a stale-version refusal only ever means real work happened.
 *
 * ITS OWN FAILURE IS CAUGHT AND LOGGED, never thrown. A database hiccup while
 * writing a note about one template must not become a whole-tenant failure in
 * `runRecurringEntries`, which would hide every other template's outcome
 * behind the one this was trying to record.
 */
export async function noteTemplateFailure(
  tenantId: string,
  entry: { id: string; version: number },
  code: string,
): Promise<boolean> {
  try {
    const rows = await withTenant(tenantId, (tx) =>
      tx
        .update(schema.recurringEntries)
        .set({ lastError: code, lastErrorAt: new Date() })
        .where(
          and(
            eq(schema.recurringEntries.tenantId, tenantId),
            eq(schema.recurringEntries.id, entry.id),
            eq(schema.recurringEntries.version, entry.version),
          ),
        )
        .returning({ id: schema.recurringEntries.id }),
    );
    return rows.length > 0;
  } catch (err) {
    console.error("recurring: could not record a template failure", err);
    return false;
  }
}

/**
 * **A RETIRED TAG IS DROPPED, NOT A REASON TO REFUSE THE ENTRY.**
 *
 * Every write path refuses an inactive dimension member outright —
 * `loadDimensionMembers` for a journal, `validateLineDimensions` for an invoice
 * or a bill — so a template tagged with a line of business somebody wound up in
 * June throws `DIMENSION_INVALID` at 6am, rolls back every catch-up month with
 * it, and leaves `next_run_date` where it was. It then fails again the next
 * morning, and the morning after, for as long as the template exists.
 *
 * Nobody would find out. The sweep reports counts only and never a template
 * name (S9, `run.ts`); the button's toast says "1 template failed" with no
 * reason; `recurring_entries` HAD no last-error column until later the same
 * day (`noteTemplateFailure` above now leaves one); and the list's
 * "template needs fixing" badge is a SHAPE check, so it never lights for this.
 * There is no update action either, so an owner who somehow diagnosed it could
 * not repair the template in place.
 *
 * **This is not the `ACCOUNT_INACTIVE` case, and the difference is what the
 * stale reference is load-bearing on.** A dead account makes the entry WRONG;
 * a retired tax rate makes the amount wrong. Both change the record, so
 * refusing is right. A retired tag changes nothing about the record — it makes
 * one report coarser. Refusing there is the failure `enterpriseMemberIds` was
 * written to stop: *"a business stopping because of a report."*
 *
 * It is the `archiveDimensionMember` contract applied where nobody is
 * watching — *"archived members stop being taggable; existing tags keep
 * reporting."* Stop being taggable is what this does.
 */
/** The subset of `ids` that no longer names an active member. */
async function retiredMemberIds(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({
      id: schema.dimensionMembers.id,
      isActive: schema.dimensionMembers.isActive,
    })
    .from(schema.dimensionMembers)
    .where(
      and(
        eq(schema.dimensionMembers.tenantId, tenantId),
        inArray(schema.dimensionMembers.id, [...ids]),
      ),
    );
  const live = new Set(rows.filter((r) => r.isActive).map((r) => r.id));
  // MISSING COUNTS AS RETIRED: a member deleted outright is no more taggable
  // than one archived, and every write path treats the two the same
  // (`!member || !member.isActive`).
  return new Set(ids.filter((id) => !live.has(id)));
}

/** Every line shape a template can hold, viewed only through its tags. */
type TaggedLine = { dimensionMemberIds?: string[] };

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

  const { due, today, closedByEntity } = await withTenant(ctx.tenantId, async (tx) => {
    const today = todayInTimezone(await getTenantTimezone(tx, ctx.tenantId));
    // PER COMPANY since ADR 0010 slice 4: a template resolves its own company
    // below, and the lock that matters is that company's. One tenant-wide date
    // would defer Maple's monthly journal to a draft because Oak closed June.
    const closedByEntity = new Map(
      (await listEntities(tx, ctx.tenantId, { includeInactive: true })).map((e) => [
        e.id,
        e.closedThrough,
      ]),
    );
    const due = await tx.query.recurringEntries.findMany({
      where: and(
        eq(schema.recurringEntries.tenantId, ctx.tenantId),
        eq(schema.recurringEntries.isActive, true),
        lte(schema.recurringEntries.nextRunDate, today),
      ),
    });
    return { due, today, closedByEntity };
  });

  const result: RecurringEntryResult = {
    created: 0,
    posted: 0,
    deferredToDraft: 0,
    periodsWalked: 0,
    tagsDropped: 0,
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
     *
     * An EDIT does not change the author. Whoever corrected the amount is on
     * the audit row (`ledger.recurring_updated`, before and after); the
     * schedule is still the decision of the person who wrote it down.
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

        /**
         * A TEMPLATE RESOLVES ITS COMPANY; A DOCUMENT FREEZES ONE. The same
         * split `recurring_entries` already makes for a sales-tax rate — a
         * template is a standing instruction, so a template naming no company
         * follows the tenant's default as it stands at generation, while the
         * invoice or bill it produces freezes whatever it was given.
         *
         * Resolved ONCE per template rather than per catch-up month, so a
         * twelve-month catch-up cannot straddle two sets of books.
         */
        const entityId =
          template.entityId ?? (await getDefaultEntityId(tx, ctx.tenantId));
        const closedThrough = closedByEntity.get(entityId) ?? null;

        /**
         * Resolved ONCE per template, above the catch-up loop, for the same
         * reason `entityId` is: twelve months of one template must not
         * straddle two answers, and one stale tag is one thing to fix rather
         * than twelve.
         */
        const taggedLines = template.lines as ReadonlyArray<TaggedLine>;
        const retired = await retiredMemberIds(
          tx,
          ctx.tenantId,
          [...new Set(taggedLines.flatMap((l) => l.dimensionMemberIds ?? []))],
        );
        const keepTags = (ids?: string[]): string[] | undefined => {
          const kept = (ids ?? []).filter((id) => !retired.has(id));
          // Undefined, not an empty array: absent is what "no tags" looks
          // like everywhere else that writes one of these.
          return kept.length > 0 ? kept : undefined;
        };
        // `retired` is already the distinct set of members this template names
        // that are no longer usable, so its size IS the number of tags to fix.
        const tagsDropped = retired.size;

        let next = entry.nextRunDate;
        // `runs` bounds the catch-up and drives `next`, so it counts PERIODS
        // and must increment whether or not the period wrote anything —
        // otherwise a deduped month would loop forever against CATCH_UP_CAP.
        // `created` is the separate question of what was written.
        let runs = 0;
        let created = 0;
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

            const outcome = await postEntry(tx, actor, {
              entityId,
              status,
              entryDate: next,
              memo: template.memo ?? entry.name,
              lines: template.lines.map((l) => {
                const tags = keepTags(l.dimensionMemberIds);
                return {
                  accountId: l.accountId,
                  amountCents: l.amountCents,
                  ...(l.memo ? { memo: l.memo } : {}),
                  ...(tags ? { dimensionMemberIds: tags } : {}),
                };
              }),
              // Stable per (template, period): a re-run cannot double-post the
              // same month even if the version CAS is somehow beaten.
              idempotencyKey: `recurring:${entry.id}:${next}`,
            });
            /**
             * **EVERY COUNTER HANGS OFF `deduped`, the deferral included.**
             *
             * A deferral is "this run wanted to post and left a draft instead".
             * If the entry was already there, this run left nothing — the run
             * that created it did, and counted it then. Reporting it again
             * would tell somebody a depreciation entry is newly stuck when
             * nothing happened at all.
             */
            if (!outcome.deduped) {
              created += 1;
              if (status === "posted") posted += 1;
              else if (wantsPost) deferred += 1;
            }
          } else if (template.kind === "invoice") {
            // Invoices are ALWAYS drafts too, and always were: a human reviews
            // before AR posts, and generation never touches the ledger, which
            // is what makes it immune to PERIOD_CLOSED. That rule came with
            // `recurring_invoices` and survives the move unchanged.
            await createInvoiceDraft(tx, actor, {
              entityId,
              customerId: entry.customerId!,
              issueDate: next,
              dueDate: addDaysIso(next, template.dueInDays),
              memo: template.memo ?? entry.name,
              lines: template.lines.map((l) => ({
                ...l,
                dimensionMemberIds: keepTags(l.dimensionMemberIds),
              })),
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
            // No idempotency key on this path — `createInvoiceDraft` always
            // inserts — so reaching here is always a record written.
            created += 1;
          } else {
            // Bills are ALWAYS drafts. Approving a bill is what posts it, and
            // that approval is the control an owner already exercises over
            // money going out — generating an approved bill would remove it.
            await createBillDraft(tx, actor, {
              entityId,
              vendorId: entry.vendorId!,
              billDate: next,
              dueDate: addDaysIso(next, template.dueInDays),
              memo: template.memo ?? entry.name,
              lines: template.lines.map((l) => ({
                ...l,
                dimensionMemberIds: keepTags(l.dimensionMemberIds),
              })),
            });
            // As above: `createBillDraft` always inserts.
            created += 1;
          }
          next = advanceMonthly(next, entry.dayOfMonth);
          runs += 1;
        }

        const rows = await tx
          .update(schema.recurringEntries)
          .set({
            nextRunDate: next,
            lastGeneratedAt: new Date(),
            // A clean run is the ONLY thing that clears the note — not an
            // edit, a pause or a resume. See the column's own comment.
            lastError: "",
            lastErrorAt: null,
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
        return { runs, created, posted, deferred, tagsDropped };
      });

      result.created += outcome.created;
      result.periodsWalked += outcome.runs;
      result.posted += outcome.posted;
      result.deferredToDraft += outcome.deferred;
      result.tagsDropped += outcome.tagsDropped;
      result.templatesRun += 1;
    } catch (err) {
      const code = err instanceof LedgerError ? err.code : "UNKNOWN";
      result.errors.push({ recurringEntryId: entry.id, name: entry.name, error: code });
      /**
       * STALE_VERSION is the one code that is not this template's failure: it
       * means another run — or, once editing exists, a save — won the row
       * between the due load and this template's transaction. The work will
       * be retried tomorrow from wherever the winner left `next_run_date`;
       * nothing about the template is wrong, so there is nothing to note.
       */
      if (code !== "STALE_VERSION") {
        await noteTemplateFailure(ctx.tenantId, entry, code);
      }
    }
  }

  return result;
}
