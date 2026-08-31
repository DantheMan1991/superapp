import "server-only";
import { and, asc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { postEntry, type LedgerCtx } from "@/modules/accounting/core";
import { allowsWrite } from "@/lib/packs/authorize";
import { enterpriseMemberIds } from "@/lib/enterprises";
import type { MovementEnterpriseTags } from "./core/enterprise";
import { InventoryError, type InventoryCtx } from "./ops";

/**
 * Where inventory's money lands in the books.
 *
 * Separate from `ops.ts` for the same reason `assets` keeps `depreciation-ops.ts`
 * apart: **this is the only part of the pack that touches core's tables, and the
 * boundary is worth being able to see.** Everything that writes goes through
 * `postEntry`, the same public entry point a hand-written journal uses. The pack
 * never inserts a journal line itself.
 *
 * **NO VALUATION IS STORED, EVER.** What stock is worth is a fold over the
 * movements — `core/valuation.ts` — exactly as an account balance is a fold over
 * journal lines rather than a maintained column. A stored valuation would be a
 * second source of truth that must agree with the ledger forever, which
 * [ADR 0007](../../../docs/decisions/0007-cash-basis-reporting.md) names as
 * accounting software's worst bug class.
 */

/** Cents. Positive = debit, negative = credit — the ledger's own convention. */
export interface InventoryAccounts {
  /** `1300 Inventory`. What stock on hand is carried as. */
  inventoryAccountId: string;
  /** `5000 Cost of Goods Sold`. Where cost goes when stock is consumed. */
  cogsAccountId: string;
  /**
   * Where a shrinkage or count variance is written off to.
   *
   * **Defaults to COGS, and that default is a judgement rather than an
   * accident.** Stock that went missing is genuinely a cost of the goods the
   * business sells, and inventing a separate account by convention would put a
   * line on the P&L that no chart in this repo actually contains. The
   * DIAGNOSTIC that slice 2 fought for is not lost by sharing an account: the
   * adjustment's reason travels in the entry memo, and grouping by reason still
   * happens where it always did, over `inventory_movements.reason`. A tenant
   * that wants shrinkage broken out sets `varianceAccountId` in config.
   */
  varianceAccountId: string;
}

/**
 * Which accounts this pack posts to.
 *
 * Resolution order, most specific first — the same shape as
 * `resolveDepreciationAccounts`:
 *   1. `tenant_modules.config.inventory` — Layer 3 tailoring, the sanctioned
 *      home for one company's differences (ADR 0009). No UI writes it yet.
 *   2. Convention: code first, then subtype.
 *
 * **REFUSES RATHER THAN GUESSING**, and the COGS case is why that matters here
 * rather than being boilerplate. The general chart ships TWO accounts with
 * subtype `cogs` — `5000 Cost of Goods Sold` and `5100 Subcontractor Expense` —
 * so a subtype lookup alone is ambiguous, and a resolver that picked the first
 * row would silently book a farm's meat against subcontractors. Code `5000` is
 * tried first for exactly that reason, and the subtype is only consulted when it
 * identifies exactly one account.
 *
 * Getting this wrong is worse than not posting at all: it is wrong quietly, and
 * it compounds with every movement until somebody reconciles.
 */
export async function resolveInventoryAccounts(
  tx: Tx,
  tenantId: string,
  config?: unknown,
): Promise<InventoryAccounts> {
  const configured = readConfiguredAccounts(config);
  const rows = await tx
    .select({
      id: schema.accounts.id,
      code: schema.accounts.code,
      subtype: schema.accounts.subtype,
      accountType: schema.accounts.accountType,
      isActive: schema.accounts.isActive,
    })
    .from(schema.accounts)
    .where(eq(schema.accounts.tenantId, tenantId));
  const active = rows.filter((r) => r.isActive);
  const byId = new Map(active.map((r) => [r.id, r]));

  const inventory =
    (configured.inventoryAccountId && byId.get(configured.inventoryAccountId)) ||
    pickOne(active.filter((r) => r.code === "1300")) ||
    pickOne(active.filter((r) => r.subtype === "inventory"));
  if (!inventory || inventory.accountType !== "asset") {
    throw new InventoryError(
      "LEDGER_ACCOUNTS",
      "Could not find exactly one active Inventory asset account (code 1300).",
    );
  }

  const cogs =
    (configured.cogsAccountId && byId.get(configured.cogsAccountId)) ||
    pickOne(active.filter((r) => r.code === "5000")) ||
    pickOne(active.filter((r) => r.subtype === "cogs"));
  if (!cogs || cogs.accountType !== "expense") {
    throw new InventoryError(
      "LEDGER_ACCOUNTS",
      "Could not find exactly one active Cost of Goods Sold account (code 5000).",
    );
  }

  // Shares COGS unless configured. See `varianceAccountId` above for why that
  // is deliberate rather than a shortcut.
  const variance =
    (configured.varianceAccountId && byId.get(configured.varianceAccountId)) ||
    cogs;
  if (variance.accountType !== "expense") {
    throw new InventoryError(
      "LEDGER_ACCOUNTS",
      "The configured inventory variance account is not an expense account.",
    );
  }

  return {
    inventoryAccountId: inventory.id,
    cogsAccountId: cogs.id,
    varianceAccountId: variance.id,
  };
}

function pickOne<T>(rows: T[]): T | null {
  return rows.length === 1 ? rows[0] : null;
}

/** `tenant_modules.config` is jsonb with no shape constraint, so parse totally. */
function readConfiguredAccounts(config: unknown): {
  inventoryAccountId?: string;
  cogsAccountId?: string;
  varianceAccountId?: string;
} {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const inv = (config as Record<string, unknown>).inventory;
  if (!inv || typeof inv !== "object" || Array.isArray(inv)) return {};
  const i = inv as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    inventoryAccountId: str(i.inventoryAccountId),
    cogsAccountId: str(i.cogsAccountId),
    varianceAccountId: str(i.varianceAccountId),
  };
}

// ------------------------------------------------------------- the posting ---

/**
 * Whether this tenant's inventory reaches the books at all, and how.
 *
 * **`none` is the default and the honest answer for most tenants** — cost
 * accumulation runs regardless (it is always on, and wanted whatever basis a
 * business files on), it simply does not post. A tenant with no accounting
 * module at all necessarily reads `none`, and asking the settings row for one
 * that does not exist is not an error here: it is the answer.
 */
export async function inventoryTreatmentOf(
  tx: Tx,
  tenantId: string,
): Promise<"none" | "capitalise"> {
  const row = await tx.query.accountingSettings.findFirst({
    where: eq(schema.accountingSettings.tenantId, tenantId),
    columns: { inventoryTreatment: true },
  });
  return row?.inventoryTreatment ?? "none";
}


/**
 * Every entry source this pack posts under. **The list is here rather than
 * inline** because `postedInventoryEntries` has to count ALL of them, and a
 * fifth source added to `ledger.ts` without being added here would make the
 * guard below quietly under-count — which presents as the switch allowing a
 * change it should have refused.
 */
const INVENTORY_ENTRY_SOURCES = [
  "inventory_receipt",
  "inventory_issue",
  "inventory_adjustment",
  "inventory_cost_adjustment",
] as const;

export interface PostedInventoryEntries {
  entries: number;
  /** Null when nothing has posted. */
  firstOn: string | null;
  lastOn: string | null;
}

/**
 * What this pack has already put in the books.
 *
 * Read before letting anybody change how inventory posts — see
 * `assertPostingChangeSafe`.
 */
export async function postedInventoryEntries(
  tx: Tx,
  tenantId: string,
): Promise<PostedInventoryEntries> {
  const [row] = await tx
    .select({
      entries: sql<string>`count(*)`,
      firstOn: sql<string | null>`min(${schema.journalEntries.entryDate})`,
      lastOn: sql<string | null>`max(${schema.journalEntries.entryDate})`,
    })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.tenantId, tenantId),
        eq(schema.journalEntries.status, "posted"),
        inArray(schema.journalEntries.source, [...INVENTORY_ENTRY_SOURCES]),
      ),
    );
  return {
    entries: Number(row?.entries ?? 0),
    firstOn: row?.firstOn ?? null,
    lastOn: row?.lastOn ?? null,
  };
}

/**
 * **TURNING POSTING OFF AFTER IT HAS POSTED STRANDS THE BALANCE SHEET, and
 * until now nothing stopped it.**
 *
 * `postMovement` returns null on `none`. So a tenant that capitalised $10,000 of
 * feed and then switched off keeps every one of those debits in Inventory, while
 * the issues that would have relieved them stop posting entirely. The stock gets
 * eaten and the asset never moves. Nothing reconciles it, nothing reports it,
 * and the valuation screen — which folds movements rather than reading the
 * ledger — goes on being right while the balance sheet quietly is not.
 *
 * The switch's own copy already says it does not backfill. **Nobody had said it
 * does not unwind either**, which is the more expensive half.
 *
 * So this refuses, and it refuses rather than warning for the reason this pack
 * refuses everywhere else: the damage is silent and compounding, and a warning
 * on a screen is read once by somebody who has already decided.
 *
 * **Turning it ON is untouched.** That direction is additive, it is where every
 * tenant starts, and the dialog already explains that history is not backfilled.
 *
 * There is deliberately NO in-product remedy offered. Unwinding capitalised
 * stock is a decision about what the business owns, made by a person, as a
 * journal entry — [ADR 0013](../../../docs/decisions/0013-inventory-tax-treatment.md)
 * §A.6 says what the software must not improvise here, and this is that.
 */
export async function assertPostingChangeSafe(
  tx: Tx,
  tenantId: string,
  next: "none" | "capitalise",
): Promise<void> {
  const current = await inventoryTreatmentOf(tx, tenantId);
  if (current === next) return;
  if (next !== "none") return;

  const posted = await postedInventoryEntries(tx, tenantId);
  if (posted.entries === 0) return;

  throw new InventoryError(
    "POSTING_LOCKED",
    `Stock has been on this business's books since ${posted.firstOn}, across ${posted.entries} ${
      posted.entries === 1 ? "entry" : "entries"
    }. Turning posting off would leave that cost sitting in Inventory with nothing left to relieve it, because issues would stop posting too. Decide what to do with the stock already capitalised first — that is a journal entry somebody makes on purpose, not a setting.`,
  );
}

/**
 * The GRNI account — `2050 Goods Received Not Invoiced`.
 *
 * Resolved by SUBTYPE rather than by code, because a tenant may legitimately
 * renumber their chart, and because `2050` could already be in use by a tenant
 * who built their own before this shipped. Refuses rather than guessing, for the
 * same reason `resolveInventoryAccounts` does: an entry landing in the wrong
 * account is worse than no entry, because it is wrong quietly.
 */
export async function resolveGrniAccount(
  tx: Tx,
  tenantId: string,
): Promise<string> {
  const rows = await tx
    .select({
      id: schema.accounts.id,
      accountType: schema.accounts.accountType,
      isActive: schema.accounts.isActive,
    })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.subtype, "goods_received"),
      ),
    );
  const active = rows.filter((r) => r.isActive && r.accountType === "liability");
  if (active.length !== 1) {
    throw new InventoryError(
      "LEDGER_ACCOUNTS",
      "Could not find exactly one active Goods Received Not Invoiced account (code 2050). Re-provision the chart of accounts.",
    );
  }
  return active[0].id;
}

/**
 * **SERVICES RECEIVED NOT INVOICED — `2060`.**
 *
 * Resolved by SUBTYPE and then by code, refusing ambiguity, the same way
 * `resolveGrniAccount` does and for the same reason: an entry landing in the
 * wrong account is worse than no entry, because it is wrong quietly.
 *
 * **NOT `2050`, AND THAT WAS THE DECISION.** A processing fee genuinely is
 * money owed for something received and not yet invoiced, so GRNI reads right —
 * and `unbilledReceipts` builds the GRNI working from stock RECEIPTS, which an
 * accrued service has none of. Putting it in 2050 would give that account a
 * balance its own reconciliation could never explain, which is the exact defect
 * `owesASupplier` was extracted to stop: a kill day's output appearing on the
 * "awaiting an invoice" list, inviting somebody to match a lumber bill against
 * chicken backs.
 */
export async function resolveServicesAccruedAccount(
  tx: Tx,
  tenantId: string,
): Promise<string> {
  const rows = await tx
    .select({
      id: schema.accounts.id,
      code: schema.accounts.code,
      accountType: schema.accounts.accountType,
      subtype: schema.accounts.subtype,
      isActive: schema.accounts.isActive,
    })
    .from(schema.accounts)
    .where(eq(schema.accounts.tenantId, tenantId));
  const active = rows.filter(
    (r) => r.isActive && r.accountType === "liability",
  );
  const bySubtype = active.filter((r) => r.subtype === "services_received");
  const picked =
    bySubtype.length === 1
      ? bySubtype[0]
      : (() => {
          const byCode = active.filter((r) => r.code === "2060");
          return byCode.length === 1 ? byCode[0] : null;
        })();
  if (!picked) {
    throw new InventoryError(
      "LEDGER_ACCOUNTS",
      "Could not find exactly one active Services Received Not Invoiced account (code 2060). Re-provision the chart of accounts.",
    );
  }
  return picked.id;
}

export interface PostServiceAccrualInput {
  /** What the entry is for — a `production_runs` row today. */
  sourceId: string;
  /** Positive cents. Zero and null post nothing. */
  amountCents: number;
  occurredOn: string;
  /** Where the work happened, for resolving the company. */
  locationAssetId: string | null;
  /**
   * **WHICH LINE OF BUSINESS THE FEE BELONGS TO**, already resolved by the
   * caller — `production` derives it from the batches that went into the run,
   * with the run's own column as the override for a mixed one. Null tags
   * nothing, which is what a genuinely mixed kill day gets.
   */
  enterpriseId?: string | null;
  memo: string;
}

/**
 * **ACCRUE A SERVICE THAT HAS BEEN CAPITALISED INTO STOCK BUT NOT INVOICED.**
 *
 * | | Debit | Credit |
 * | --- | --- | --- |
 * | the fee | the consumption account | Services Received Not Invoiced |
 *
 * **THIS ENTRY EXISTS TO MAKE ANOTHER ENTRY HONEST.** A production run's output
 * receipt credits the CONSUMPTION account rather than GRNI, because the run's
 * inputs were debited there on the way in and a transformation must net to
 * nothing on the P&L. That holds exactly as long as everything in the pot was
 * debited to consumption first — and a processing fee taken from a quote never
 * was. Without this, completing a run leaves a credit balance in an expense
 * account, self-correcting only if the plant's bill happens to be coded to the
 * same place and never if it is coded to a "contract butchering" account of its
 * own.
 *
 * Worked through, for a $600 fee:
 *
 * ```
 * accrual        Dr 5000 600   Cr 2060 600
 * output lands   Dr 1300 600   Cr 5000 600
 * bill matched   Dr 2060 600   Cr AP   600
 *                ───────────────────────────
 *                1300 = 600 · 2060 = 0 · 5000 = 0 · AP = 600 · P&L = 0
 * ```
 *
 * **THE LAST LINE OF THAT TABLE IS NOT BUILT YET**, and the balance left in
 * 2060 is the point rather than a gap: a non-zero balance per plant IS the list
 * of processing nobody has been invoiced for, which is the same self-surfacing
 * shape `missedBookings` has — nothing has to remember to set a flag.
 *
 * Returns null when nothing was posted: a tenant on `none`, or a fee of zero,
 * which is a plant that waived it and has nothing to accrue.
 */
export async function postServiceAccrual(
  tx: Tx,
  ctx: InventoryCtx,
  input: PostServiceAccrualInput,
): Promise<{ entryId: string } | null> {
  if (input.amountCents <= 0) return null;
  const treatment = await inventoryTreatmentOf(tx, ctx.tenantId);
  if (treatment === "none") return null;

  const accounts = await resolveInventoryAccounts(tx, ctx.tenantId);
  const accruedAccountId = await resolveServicesAccruedAccount(tx, ctx.tenantId);
  const entityId = await resolveMovementEntity(
    tx,
    ctx.tenantId,
    input.locationAssetId,
  );
  // **THE DEBIT AND THE RECEIPT IT EXPLAINS HAVE TO AGREE.** The outputs
  // capitalised under this line of business a moment ago and credited the
  // consumption account for the whole pot; if the fee's own debit to that
  // account went untagged, the enterprise would carry a credit nothing offsets
  // and its margin would read better than it is.
  const dimensionMemberIds = await enterpriseLineTag(
    tx,
    ctx.tenantId,
    input.enterpriseId ?? null,
  );

  const { entry } = await postEntry(tx, ledgerCtx(ctx), {
    entityId,
    status: "posted",
    entryDate: input.occurredOn,
    memo: input.memo,
    source: "production_processing_accrual",
    sourceId: input.sourceId,
    idempotencyKey: `production:processing_accrual:${input.sourceId}`,
    lines: [
      {
        accountId: accounts.cogsAccountId,
        amountCents: input.amountCents,
        dimensionMemberIds,
      },
      {
        accountId: accruedAccountId,
        amountCents: -input.amountCents,
        dimensionMemberIds,
      },
    ],
  });
  return { entryId: entry.id };
}

/** The ledger context a machine posting runs under. See ADR 0011. */
function ledgerCtx(ctx: InventoryCtx): LedgerCtx {
  return { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role };
}


/**
 * **THE COMPANY A MOVEMENT'S COST BELONGS TO.**
 *
 * A movement carries no `entity_id`, so this used to be
 * `getDefaultEntityId(tenantId)` — and in a tenant with two companies that was
 * silently wrong in the worst available way. The receipt capitalised in the
 * DEFAULT company while the bill clearing it posted to the bill's own company,
 * so neither GRNI ever netted: one carried a permanent credit the reconciliation
 * called settled, the other a permanent debit, and the stock sat on the wrong
 * balance sheet. Only a consolidated view hid it.
 *
 * `assets` solved this before and the answer is copied deliberately — its
 * `entityOf` REFUSES rather than falling back to the tenant default, because
 * *"a default chosen at posting time is exactly the behaviour this column
 * replaced"*. Same reasoning, same refusal.
 *
 * Resolution, and note the order:
 *   1. **One postable company: use it.** Not a guess — there is nothing to be
 *      ambiguous about, and this is nearly every tenant.
 *   2. **More than one: the location's company.** A freezer, a barn or a market
 *      truck is an `asset`, and an asset already names the books it belongs to.
 *      That is the honest answer to "whose stock is this" for a business that
 *      keeps two sets of them.
 *   3. **Otherwise refuse.** Stock sitting nowhere in particular, in a tenant
 *      with two companies, cannot be capitalised into either without inventing
 *      the answer.
 */
export async function resolveMovementEntity(
  tx: Tx,
  tenantId: string,
  locationAssetId: string | null,
): Promise<string> {
  const companies = await tx
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .where(
      and(
        eq(schema.entities.tenantId, tenantId),
        eq(schema.entities.isActive, true),
      ),
    );
  if (companies.length === 1) return companies[0].id;
  if (companies.length === 0) {
    throw new InventoryError(
      "LEDGER_ACCOUNTS",
      "This business has no company to post to. Open the books first.",
    );
  }

  if (locationAssetId) {
    const asset = await tx.query.assets.findFirst({
      where: and(
        eq(schema.assets.tenantId, tenantId),
        eq(schema.assets.id, locationAssetId),
      ),
      columns: { entityId: true, name: true },
    });
    if (asset?.entityId) return asset.entityId;
    throw new InventoryError(
      "ENTITY_AMBIGUOUS",
      `${asset?.name ?? "That place"} does not say which company it belongs to, and this business keeps more than one set of books. Set the company on it first.`,
    );
  }

  throw new InventoryError(
    "ENTITY_AMBIGUOUS",
    "This business keeps more than one set of books, so stock has to say where it is before its cost can be posted.",
  );
}

/**
 * **DOES STOCK OF THIS PROVENANCE OWE A SUPPLIER ANYTHING?**
 *
 * Bought stock credits Goods Received Not Invoiced when it arrives, so a bill
 * can clear it. Stock the business MADE or RAISED credits the consumption
 * account instead — a run's inputs were charged there on the way in and its
 * output credits the same account on the way out — so there is nothing in GRNI
 * against it and no supplier will ever invoice for it.
 *
 * Lot-less stock is treated as bought, which is what a receipt with no batch
 * almost always is, and matches what `postMovement` does.
 *
 * **SHARED ON PURPOSE.** `postMovement` used this test and `unbilledReceipts`
 * did not, so a kill day's output was listed as "awaiting an invoice" on the
 * live app — inviting somebody to match a lumber bill against chicken backs,
 * and guaranteeing the GRNI working could never agree with the account. One
 * predicate, so the two ends cannot drift again.
 */
export function owesASupplier(lotSource: string | null): boolean {
  return lotSource === null || lotSource === "purchased";
}

/**
 * **THE LINE TAG FOR ONE ENTERPRISE — the whole of slice 3's contact with the
 * ledger.**
 *
 * A journal line is tagged with a `dimension_members` id, never with an
 * enterprise id, so every posting here ends in this translation.
 * `enterpriseMemberIds` is the door; this wraps it in the shape `postEntry`
 * wants and in the two refusals a posting path needs.
 *
 * **UNTAGGED RETURNS `undefined` AND NOT AN EMPTY ARRAY**, because that is what
 * `EntryLineInput.dimensionMemberIds` reads as "no dimensions" — and it is the
 * ordinary case rather than a failure. Most of what a business holds belongs to
 * no line of business, and the P&L already renders an Unassigned column.
 *
 * **AN ENTERPRISE WITH NO ACTIVE MEMBER POSTS UNTAGGED RATHER THAN FAILING.**
 * The map is active-only by construction, so a batch still tagged with a
 * retired line of business simply stops contributing a member — which is
 * exactly *"archived members stop being taggable; existing tags keep
 * reporting."* Throwing instead would make retiring an enterprise stop stock
 * being recorded, and `postMovement` runs inside `recordMovement`.
 */
async function enterpriseLineTag(
  tx: Tx,
  tenantId: string,
  enterpriseId: string | null,
): Promise<string[] | undefined> {
  if (!enterpriseId) return undefined;
  const members = await enterpriseMemberIds(tx, tenantId);
  const memberId = members.get(enterpriseId);
  return memberId ? [memberId] : undefined;
}

/**
 * The enterprise a batch's cost belongs to — the lot's own tag, and nothing
 * else.
 *
 * The two money-only postings (`postCostAdjustment`, `postCapitalisation`) have
 * no movement to reason from, so they read the batch directly. See
 * `core/enterprise.ts` for why a batch does not fall back to its item.
 */
async function enterpriseOfLot(
  tx: Tx,
  tenantId: string,
  lotId: string,
): Promise<string | null> {
  const lot = await tx.query.inventoryLots.findFirst({
    where: and(
      eq(schema.inventoryLots.tenantId, tenantId),
      eq(schema.inventoryLots.id, lotId),
    ),
    columns: { enterpriseId: true },
  });
  return lot?.enterpriseId ?? null;
}

/**
 * Movement kinds that NEVER post, whatever they carry.
 *
 * They move stock (and its cost) WITHIN inventory, so the entry would be
 * `Dr 1300 / Cr 1300` — a row that says nothing and balances. ADR 0012 §A.3.
 */
const NEVER_POST = new Set([
  "transfer_in",
  "transfer_out",
  "split_in",
  "split_out",
  "merge_in",
  "merge_out",
  "placement",
]);

export interface PostMovementInput {
  movementId: string;
  movementKind: string;
  /** Signed exactly as the movement is: positive in, negative out. */
  quantity: number;
  /** The movement's own cost. Null or zero posts nothing. */
  costCents: number | null;
  /**
   * Where the stock came from — the LOT's `source`, or null for lot-less stock.
   *
   * **THIS DECIDES THE CREDIT SIDE OF A RECEIPT, and getting it from the
   * movement kind instead was a real bug.** Every receipt used to credit GRNI,
   * including stock the business MADE: a production run lands its outputs
   * through `receiveStock`, so completing one minted a payable no supplier
   * would ever invoice — and because the run's inputs had already been charged
   * to consumption on the way in, the same pot of cost hit the P&L twice.
   */
  lotSource: string | null;
  occurredOn: string;
  itemId: string;
  lotCode?: string | null;
  /** Which place the stock moved at — how the company is resolved. */
  locationAssetId: string | null;
  /**
   * **WHICH LINE OF BUSINESS EACH SIDE BELONGS TO**, already resolved.
   *
   * Two values and not one, because a stock issue can cross enterprises and
   * putting the consumer on the inventory line said Broilers held stock it
   * never had — see `core/enterprise.ts`, which is where the rule lives and
   * where it can be read without a transaction.
   *
   * Passed in rather than worked out here, because `recordMovement` has loaded
   * the item, the batch and the consuming batch by the time it calls this and
   * re-reading all three would be three queries to answer a question already in
   * hand.
   *
   * Null on either side is ordinary and leaves that line untagged. There is no
   * back-fill: every entry written before this carries no enterprise and cannot
   * get one without rewriting history.
   */
  enterprises?: MovementEnterpriseTags;
}

const MEMO_VERB = {
  in: "Stock received",
  out: "Stock issued",
  adjustment: "Stock adjusted",
} as const;

/**
 * Post one stock movement to the ledger, if this tenant posts at all.
 *
 * | What moved | Debit | Credit |
 * | --- | --- | --- |
 * | bought stock in | Inventory | Goods Received Not Invoiced |
 * | made or raised stock in | Inventory | the consumption account |
 * | stock out | the consumption account | Inventory |
 * | stock out, adjustment | the variance account | Inventory |
 *
 * **A MADE THING CREDITS CONSUMPTION, NOT GRNI**, and that is what makes a
 * production run net to nothing on the P&L: its inputs were debited to
 * consumption on the way in, and its output credits the same account on the way
 * out. Total inventory value is unchanged by a transformation, which is the
 * truth a run represents. Crediting GRNI instead would accrue a liability for
 * goods nobody sold the business.
 *
 * **EVERY LINE IS TAGGED WITH THE LINE OF BUSINESS IT DESCRIBES**, when the
 * caller resolved one — the cost bearer on the P&L side, the batch's own on the
 * stock side. This is what makes profit per enterprise a report rather than a
 * substring search, and it reaches further than feed: `retail` sells through
 * `issueStock`, so a market sale's cost of goods lands under Broilers by the
 * same path a pen of them eating crumble does.
 *
 * Returns `null` when nothing was posted, which is the ordinary case: a tenant
 * on `none`, a kind that never posts, or a movement with no cost. **A movement
 * with no cost posts NOTHING rather than posting zero** — the distinction
 * `carriedValue` exists to keep, arriving in the ledger.
 */
export async function postMovement(
  tx: Tx,
  ctx: InventoryCtx,
  input: PostMovementInput,
): Promise<{ entryId: string } | null> {
  if (!input.costCents) return null;
  if (NEVER_POST.has(input.movementKind)) return null;
  const treatment = await inventoryTreatmentOf(tx, ctx.tenantId);
  if (treatment === "none") return null;

  const accounts = await resolveInventoryAccounts(tx, ctx.tenantId);
  const entityId = await resolveMovementEntity(
    tx,
    ctx.tenantId,
    input.locationAssetId,
  );
  const item = await tx.query.inventoryItems.findFirst({
    where: eq(schema.inventoryItems.id, input.itemId),
    columns: { name: true },
  });

  const incoming = input.quantity > 0;
  const bought = owesASupplier(input.lotSource);
  const cost = input.costCents;

  /**
   * **EVERY LINE IS TAGGED, BUT NOT ALL WITH THE SAME ONE.** The line that says
   * where the cost went carries the cost bearer; the line that says whose stock
   * moved carries the batch's own. They differ only on a cross-enterprise
   * issue, which is exactly the movement this dimension exists to get right —
   * see `core/enterprise.ts` for the false negative the single-tag version put
   * in `1300`.
   */
  const costTag = await enterpriseLineTag(
    tx,
    ctx.tenantId,
    input.enterprises?.cost ?? null,
  );
  const stockTag = await enterpriseLineTag(
    tx,
    ctx.tenantId,
    input.enterprises?.stock ?? null,
  );

  // Positive = debit, negative = credit — the ledger's own convention.
  const lines = incoming
    ? [
        {
          accountId: accounts.inventoryAccountId,
          amountCents: cost,
          dimensionMemberIds: stockTag,
        },
        {
          // GRNI is what this batch's supplier is owed, and the consumption
          // account on a made thing was charged by this batch's own inputs.
          // Both are the batch's, never a consumer's.
          accountId: bought
            ? await resolveGrniAccount(tx, ctx.tenantId)
            : accounts.cogsAccountId,
          amountCents: -cost,
          dimensionMemberIds: stockTag,
        },
      ]
    : [
        {
          accountId:
            input.movementKind === "adjustment"
              ? accounts.varianceAccountId
              : accounts.cogsAccountId,
          amountCents: cost,
          dimensionMemberIds: costTag,
        },
        {
          accountId: accounts.inventoryAccountId,
          amountCents: -cost,
          dimensionMemberIds: stockTag,
        },
      ];

  const source = incoming
    ? ("inventory_receipt" as const)
    : input.movementKind === "adjustment"
      ? ("inventory_adjustment" as const)
      : ("inventory_issue" as const);

  const verb = incoming
    ? MEMO_VERB.in
    : input.movementKind === "adjustment"
      ? MEMO_VERB.adjustment
      : MEMO_VERB.out;

  const { entry } = await postEntry(tx, ledgerCtx(ctx), {
    entityId,
    status: "posted",
    entryDate: input.occurredOn,
    memo:
      `${verb} — ${item?.name ?? "stock"}` +
      (input.lotCode ? ` (${input.lotCode})` : ""),
    // ADR 0011: this source posts without the owner check, because the
    // authorisation happened where the stock moved.
    source,
    sourceId: input.movementId,
    idempotencyKey: `inventory:${source}:${input.movementId}`,
    lines,
  });
  return { entryId: entry.id };
}


/**
 * **STOCK BECAME A CAPITAL ASSET, or came back from being one.**
 *
 * The posting half of a reclassification: the business still owns the thing, it
 * has simply stopped being for sale. Dr the fixed-asset account, Cr inventory —
 * and the reverse on the way back.
 *
 * **THIS IS NOT `postMovement` WITH A DIFFERENT ACCOUNT, and the difference is
 * the whole point.** An ordinary outgoing movement credits inventory and debits
 * COGS, which says the cost was consumed. Capitalising says the opposite: the
 * cost survives, on the other side of the balance sheet. A farm that ran a
 * breeding cow out through the normal path would have expensed an animal it
 * still owns and understated its assets by her whole cost.
 *
 * **NEUTRAL ON PURPOSE.** Nothing here knows what a heifer is. A dealership
 * moving a demonstrator out of stock, a hire company capitalising a machine off
 * the shelf — same entry, same seam. `livestock` is only its first caller.
 *
 * Returns null when the tenant does not post inventory at all, exactly as
 * `postMovement` does: the reclassification still HAPPENED and is still
 * recorded, it just has no books to land in.
 */
export async function postCapitalisation(
  tx: Tx,
  ctx: InventoryCtx,
  input: {
    /** What this entry is evidence of — the transfer row's id. */
    sourceId: string;
    itemId: string;
    lotId: string;
    lotCode?: string | null;
    /** What moved, in cents. Always positive; `direction` says which way. */
    costCents: number;
    /** The fixed-asset account the cost lands in, or leaves from. */
    counterAccountId: string;
    occurredOn: string;
    /** `out` — stock became an asset. `in` — an asset came back to stock. */
    direction: "out" | "in";
  },
): Promise<{ entryId: string } | null> {
  if (!input.costCents) return null;
  const treatment = await inventoryTreatmentOf(tx, ctx.tenantId);
  if (treatment === "none") return null;

  const accounts = await resolveInventoryAccounts(tx, ctx.tenantId);
  // The BATCH's company, not the movement's location: a reclassification is
  // money rather than a place, the same reasoning `postCostAdjustment` uses.
  const entityId = await resolveLotEntity(tx, ctx.tenantId, input.lotId);
  const item = await tx.query.inventoryItems.findFirst({
    where: eq(schema.inventoryItems.id, input.itemId),
    columns: { name: true },
  });

  const out = input.direction === "out";
  // The batch's line of business, for the same reason the company comes from
  // the batch: a reclassification is money rather than a place.
  const dimensionMemberIds = await enterpriseLineTag(
    tx,
    ctx.tenantId,
    await enterpriseOfLot(tx, ctx.tenantId, input.lotId),
  );
  // Positive = debit, negative = credit — the ledger's own convention.
  const lines = out
    ? [
        {
          accountId: input.counterAccountId,
          amountCents: input.costCents,
          dimensionMemberIds,
        },
        {
          accountId: accounts.inventoryAccountId,
          amountCents: -input.costCents,
          dimensionMemberIds,
        },
      ]
    : [
        {
          accountId: accounts.inventoryAccountId,
          amountCents: input.costCents,
          dimensionMemberIds,
        },
        {
          accountId: input.counterAccountId,
          amountCents: -input.costCents,
          dimensionMemberIds,
        },
      ];

  const { entry } = await postEntry(tx, ledgerCtx(ctx), {
    entityId,
    status: "posted",
    entryDate: input.occurredOn,
    memo:
      `${out ? "Capitalised" : "Returned to stock"} — ${item?.name ?? "stock"}` +
      (input.lotCode ? ` (${input.lotCode})` : ""),
    source: "inventory_adjustment",
    sourceId: input.sourceId,
    // ADR 0011: posts without the owner check, because the authorisation
    // happened where the stock moved.
    idempotencyKey: `inventory:capitalisation:${input.sourceId}`,
    lines,
  });
  return { entryId: entry.id };
}

/**
 * **THE COMPANY A BATCH'S COST BELONGS TO.**
 *
 * A cost correction has no location of its own — it is money, not a movement —
 * so `resolveMovementEntity` has nothing to be handed. The batch does: its stock
 * has been somewhere, and a place is an `asset`, and an asset already names the
 * books it belongs to.
 *
 * Same order and the same refusal as `resolveMovementEntity`, for the same
 * reason: **one postable company is not a guess**, and where there is more than
 * one, a default chosen at posting time is exactly the behaviour the
 * `entity_id` column replaced. A batch that has moved between two companies'
 * places is refused rather than assigned to whichever query row came back
 * first.
 */
export async function resolveLotEntity(
  tx: Tx,
  tenantId: string,
  lotId: string,
): Promise<string> {
  const companies = await tx
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .where(
      and(
        eq(schema.entities.tenantId, tenantId),
        eq(schema.entities.isActive, true),
      ),
    );
  if (companies.length === 1) return companies[0].id;
  if (companies.length === 0) {
    throw new InventoryError(
      "LEDGER_ACCOUNTS",
      "This business has no company to post to. Open the books first.",
    );
  }

  const places = await tx
    .selectDistinct({ locationAssetId: schema.inventoryMovements.locationAssetId })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        eq(schema.inventoryMovements.lotId, lotId),
        isNotNull(schema.inventoryMovements.locationAssetId),
      ),
    );
  const locationIds = places
    .map((p) => p.locationAssetId)
    .filter((id): id is string => id !== null);
  if (locationIds.length === 0) {
    throw new InventoryError(
      "ENTITY_AMBIGUOUS",
      "This business keeps more than one set of books, so this batch has to say where it is before its cost can be corrected.",
    );
  }

  const rows = await tx
    .select({
      entityId: schema.assets.entityId,
      name: schema.assets.name,
    })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.tenantId, tenantId),
        inArray(schema.assets.id, locationIds),
      ),
    );
  const unnamed = rows.find((r) => !r.entityId);
  if (unnamed) {
    throw new InventoryError(
      "ENTITY_AMBIGUOUS",
      `${unnamed.name} does not say which company it belongs to, and this business keeps more than one set of books. Set the company on it first.`,
    );
  }
  const entityIds = new Set(rows.map((r) => r.entityId!));
  if (entityIds.size !== 1) {
    throw new InventoryError(
      "ENTITY_AMBIGUOUS",
      "This batch has been kept in places belonging to more than one company, so there is no single set of books to correct its cost in.",
    );
  }
  return [...entityIds][0];
}

export interface PostCostAdjustmentInput {
  adjustmentId: string;
  itemId: string;
  lotId: string;
  lotCode: string | null;
  occurredOn: string;
  /** The stored split. Both SIGNED; either may be zero. */
  onHandCents: number;
  issuedCents: number;
}

/**
 * Post a cost correction — ADR 0012 §A.4.
 *
 * | Half of the correction | Debit | Credit |
 * | --- | --- | --- |
 * | still on hand | Inventory | the variance account |
 * | already issued | the consumption account | the variance account |
 *
 * **THE CREDIT IS THE VARIANCE ACCOUNT AND DELIBERATELY NOT GRNI**, which is
 * the one decision in this posting that had a plausible alternative.
 *
 * Crediting Goods Received Not Invoiced reads right — a delivery that cost $60
 * more than the ticket said is $60 more that a supplier will invoice for — and
 * it is wrong in a way that only shows up later. **Matching clears GRNI at the
 * RECEIPT's stamped cost**, and a receipt's stamped cost is not what a
 * correction changes, so the extra credit is one nothing can ever debit: a
 * permanent balance in a liability account, in the exact place slice 3c built a
 * reconciliation to make such things visible, blamed by that card on
 * "deliveries from before the switch". It would also DOUBLE COUNT, because when
 * the invoice does arrive §A.5 books the same difference again.
 *
 * So the two mechanisms are complementary rather than overlapping:
 * **§A.5 corrects the books when an invoice disagrees with the ticket; §A.4
 * corrects the stock record when there is no invoice to disagree with.** They
 * land in the same account, which is why a delivery that gets both ends up with
 * the right inventory value, the right liability and no net variance — traced
 * in the dossier.
 *
 * **THE LINES ARE NETTED BY ACCOUNT AND ZEROES ARE DROPPED**, which is not
 * tidiness: `varianceAccountId` DEFAULTS to the consumption account, so a
 * correction against a batch that has been entirely issued out would otherwise
 * try to post `Dr 5000 / Cr 5000`, and `postEntry` refuses a zero-amount line.
 * Netted, that correction posts nothing at all — which is the truth about it,
 * and leaves the ledger and `lotCarried` agreeing by construction rather than
 * by a second calculation.
 *
 * Returns null when nothing was posted: a tenant on `none`, or a correction
 * whose halves cancel in one account.
 */
export async function postCostAdjustment(
  tx: Tx,
  ctx: InventoryCtx,
  input: PostCostAdjustmentInput,
): Promise<{ entryId: string } | null> {
  const treatment = await inventoryTreatmentOf(tx, ctx.tenantId);
  if (treatment === "none") return null;

  const accounts = await resolveInventoryAccounts(tx, ctx.tenantId);
  const entityId = await resolveLotEntity(tx, ctx.tenantId, input.lotId);
  const item = await tx.query.inventoryItems.findFirst({
    where: eq(schema.inventoryItems.id, input.itemId),
    columns: { name: true },
  });

  // Correcting what a batch cost is still that batch's cost, so it carries the
  // batch's line of business — otherwise a $60 correction to a Broilers
  // delivery would land in Unassigned while the delivery itself did not.
  const dimensionMemberIds = await enterpriseLineTag(
    tx,
    ctx.tenantId,
    await enterpriseOfLot(tx, ctx.tenantId, input.lotId),
  );

  // Positive = debit, negative = credit — the ledger's own convention.
  const byAccount = new Map<string, number>();
  const add = (accountId: string, amountCents: number) => {
    byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + amountCents);
  };
  add(accounts.inventoryAccountId, input.onHandCents);
  add(accounts.cogsAccountId, input.issuedCents);
  add(accounts.varianceAccountId, -(input.onHandCents + input.issuedCents));

  const lines = [...byAccount.entries()]
    .filter(([, amountCents]) => amountCents !== 0)
    .map(([accountId, amountCents]) => ({
      accountId,
      amountCents,
      dimensionMemberIds,
    }));
  if (lines.length < 2) return null;

  const { entry } = await postEntry(tx, ledgerCtx(ctx), {
    entityId,
    status: "posted",
    entryDate: input.occurredOn,
    memo:
      `Cost corrected — ${item?.name ?? "stock"}` +
      (input.lotCode ? ` (${input.lotCode})` : ""),
    /**
     * **NOT A MACHINE SOURCE, unlike the three movement postings.** Re-stating
     * what stock cost is an owner's decision rather than a chore riding one, so
     * this entry meets `requireOwnerRole` in `postEntry` like any hand-written
     * journal — and `adjustLotCost` refuses a non-owner before it ever gets
     * here. See the note beside the enum value in `db/schema/ledger.ts`.
     */
    source: "inventory_cost_adjustment",
    sourceId: input.adjustmentId,
    idempotencyKey: `inventory:inventory_cost_adjustment:${input.adjustmentId}`,
    lines,
  });
  return { entryId: entry.id };
}

// ------------------------------------------------------- matching the bill ---

export interface UnbilledReceipt {
  movementId: string;
  itemId: string;
  itemName: string;
  unit: string;
  lotId: string | null;
  lotCode: string | null;
  locationAssetId: string | null;
  occurredOn: string;
  quantity: number;
  costCents: number;
  /** Already matched against this receipt by some bill line. */
  matchedQuantity: number;
  matchedCostCents: number;
  /** What is still waiting for an invoice. Can be zero; never negative here. */
  openQuantity: number;
  openCostCents: number;
}

/**
 * **STOCK THAT HAS ARRIVED AND HAS NOT BEEN INVOICED** — the working list for
 * matching a bill, and the detail behind the GRNI balance.
 *
 * A receipt with no cost is EXCLUDED: it credited nothing to GRNI, so there is
 * nothing for a bill to clear against it. That is not the same as saying it is
 * settled, and the valuation screen's "what this figure leaves out" card is
 * where an uncosted delivery shows up. Two different questions, two different
 * screens, and conflating them would make an unpriced delivery look reconciled.
 */
export async function unbilledReceipts(
  tx: Tx,
  tenantId: string,
  opts: {
    itemId?: string;
    limit?: number;
    movementIds?: string[];
    /**
     * Ignore what THIS bill line already claims.
     *
     * Re-matching the same pair is a CORRECTION to the first match, which the
     * per-pair unique index exists to allow. Without this the receipt reads as
     * fully matched by its own prior allocation, so the correction is refused
     * with "already fully invoiced" — about a delivery the caller is in the
     * middle of re-stating.
     */
    exceptBillLineId?: string;
  } = {},
): Promise<UnbilledReceipt[]> {
  // Built as SQL rather than passed as a null parameter: Postgres cannot infer
  // the type of a bare null here and refuses the whole query with 42P18.
  const exceptLine = opts.exceptBillLineId
    ? sql`and a.bill_line_id <> ${opts.exceptBillLineId}::uuid`
    : sql``;
  const rows = await tx
    .select({
      movementId: schema.inventoryMovements.id,
      itemId: schema.inventoryMovements.itemId,
      itemName: schema.inventoryItems.name,
      unit: schema.inventoryItems.stockingUnit,
      lotId: schema.inventoryMovements.lotId,
      lotCode: schema.inventoryLots.code,
      locationAssetId: schema.inventoryMovements.locationAssetId,
      occurredOn: schema.inventoryMovements.occurredOn,
      quantity: schema.inventoryMovements.quantity,
      costCents: schema.inventoryMovements.costCents,
      matchedQuantity: sql<string>`coalesce((
        select sum(a.quantity_matched) from bill_line_stock_allocations a
         where a.tenant_id = ${schema.inventoryMovements.tenantId}
           and a.inventory_movement_id = ${schema.inventoryMovements.id}
           ${exceptLine}
      ), 0)`,
      matchedCostCents: sql<string>`coalesce((
        select sum(a.receipt_cost_cents) from bill_line_stock_allocations a
         where a.tenant_id = ${schema.inventoryMovements.tenantId}
           and a.inventory_movement_id = ${schema.inventoryMovements.id}
           ${exceptLine}
      ), 0)`,
    })
    .from(schema.inventoryMovements)
    .innerJoin(
      schema.inventoryItems,
      and(
        eq(schema.inventoryItems.tenantId, schema.inventoryMovements.tenantId),
        eq(schema.inventoryItems.id, schema.inventoryMovements.itemId),
      ),
    )
    .leftJoin(
      schema.inventoryLots,
      and(
        eq(schema.inventoryLots.tenantId, schema.inventoryMovements.tenantId),
        eq(schema.inventoryLots.id, schema.inventoryMovements.lotId),
      ),
    )
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, tenantId),
        eq(schema.inventoryMovements.movementKind, "receipt"),
        // **> 0, not "is not null".** A receipt entered at zero credited
        // nothing to GRNI — `postMovement` declines it on exactly that value —
        // so there is nothing for a bill to clear against it. Listing it let a
        // whole invoice land in the variance account as a "price difference"
        // while `1300` never moved. `isNotNull` was the bug; the doc comment
        // above already said `> 0`.
        gt(schema.inventoryMovements.costCents, 0),
        // Only stock somebody SOLD this business can be invoiced for. A made or
        // raised lot credited the consumption account, not GRNI, so there is
        // nothing here for a bill to clear — see `owesASupplier`.
        sql`(${schema.inventoryLots.source} is null or ${schema.inventoryLots.source} = 'purchased')`,
        opts.itemId
          ? eq(schema.inventoryMovements.itemId, opts.itemId)
          : undefined,
        opts.movementIds
          ? inArray(schema.inventoryMovements.id, opts.movementIds)
          : undefined,
      ),
    )
    .orderBy(asc(schema.inventoryMovements.occurredOn))
    .limit(opts.limit ?? 200);

  return rows
    .map((r) => {
      const matchedQuantity = round4(Number(r.matchedQuantity));
      const matchedCostCents = Number(r.matchedCostCents);
      const costCents = r.costCents ?? 0;
      return {
        movementId: r.movementId,
        itemId: r.itemId,
        itemName: r.itemName,
        unit: r.unit,
        lotId: r.lotId,
        lotCode: r.lotCode,
        locationAssetId: r.locationAssetId,
        occurredOn: r.occurredOn,
        quantity: r.quantity,
        costCents,
        matchedQuantity,
        matchedCostCents,
        openQuantity: round4(r.quantity - matchedQuantity),
        openCostCents: costCents - matchedCostCents,
      };
    })
    .filter((r) => r.openQuantity > 0);
}


function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export interface AllocateBillLineInput {
  billLineId: string;
  /**
   * **WHAT THE INVOICE CHARGES IS NOT A PARAMETER. It is the line.**
   *
   * It used to be passed in, and nothing reconciled it with the line it
   * rewrites — so a caller could quietly change what the bill posts to AP while
   * the aging report kept the old number. Deriving it removes the disagreement
   * instead of validating it away, and it makes the freight case correct by
   * construction: whatever is not matched to stock stays on the bill as an
   * expense line rather than vanishing from the total.
   */
  /**
   * How many units the invoice says it is charging for.
   *
   * **THIS IS WHAT TELLS A PRICE DIFFERENCE FROM A SHORT DELIVERY**, and
   * without it the two were indistinguishable: every gap between the invoice
   * and the tickets was booked as a price variance, so an invoice for six bags
   * against four that arrived was EXPENSED and GRNI cleared to zero. The
   * shortfall then showed nowhere, and nobody chased the supplier for the two
   * bags. ADR 0012 case 6 says it stays in GRNI where it can be seen.
   *
   * Omitted means "the same quantity we matched" — an ordinary invoice for
   * exactly what turned up.
   */
  invoiceQuantity?: number;
  matches: { movementId: string; quantityMatched: number }[];
}

/**
 * **MATCH A BILL LINE TO THE DELIVERIES IT IS PAYING FOR**, and point the line
 * at GRNI so approving the bill clears what the receipts credited.
 *
 * **THE BILL LINE'S ACCOUNT IS SET HERE, NOT AT APPROVAL, and that is a layering
 * decision rather than a convenience.** `approveBill` lives in accounting core,
 * which is industry-blind and must not reach into a pack — so the substitution
 * cannot happen there. Setting the account at match time means `approveBill`
 * copies it verbatim, exactly as it does for every other line, and the bill path
 * is untouched by this slice.
 *
 * The invoice cost is split across the matches **by the receipts' own costs**,
 * not evenly: two deliveries of the same feed at different prices should each
 * carry its share of a combined invoice in proportion to what it was worth, and
 * splitting evenly would misstate both. The largest-remainder rule keeps the
 * parts summing to the whole.
 */
export async function allocateBillLineToStock(
  tx: Tx,
  ctx: InventoryCtx,
  input: AllocateBillLineInput,
): Promise<{
  allocations: number;
  /** Charged at a different RATE than the ticket said. Goes to the P&L. */
  varianceCents: number;
  /** Charged for stock that never arrived. Stays in GRNI to be chased. */
  shortfallCents: number;
}> {
  // OWNER. Matching a bill to a delivery decides what stock cost and clears a
  // liability — a decision, not a chore, which is the same line `livestock`
  // drew when it made movements member-level and lots owner-level.
  if (!allowsWrite(ctx.role, "owner")) {
    throw new InventoryError("FORBIDDEN", "only an owner can match a bill to stock");
  }
  if (input.matches.length === 0) {
    throw new InventoryError(
      "LOT_INVALID",
      "pick at least one delivery for this line",
    );
  }

  /**
   * **MATCHING ONLY MEANS ANYTHING IF THE RECEIPT CAPITALISED.**
   *
   * Only `postMovement` used to check the treatment, so with posting OFF a
   * receipt credited nothing to GRNI — and matching still re-coded the bill line
   * to it. Approving then posted `Dr 2050` against a credit that was never
   * made, leaving a debit balance in Goods Received Not Invoiced that no
   * delivery explains and nothing can ever clear.
   *
   * Found by opening the screen on a farm that had just switched accounting on
   * and had not turned posting on: the deliveries were listed and offered for
   * matching, which is the point at which it becomes obvious that "what has
   * arrived" and "what the books think has arrived" are different questions.
   */
  const treatment = await inventoryTreatmentOf(tx, ctx.tenantId);
  if (treatment === "none") {
    throw new InventoryError(
      "POSTING_OFF",
      "Stock is not on the balance sheet for this business, so there is nothing for a bill to settle. Turn that on first.",
    );
  }

  const line = await tx.query.billLines.findFirst({
    where: and(
      eq(schema.billLines.tenantId, ctx.tenantId),
      eq(schema.billLines.id, input.billLineId),
    ),
  });
  if (!line) throw new InventoryError("NOT_FOUND", "bill line");

  /**
   * **THE BILL MUST STILL BE A DRAFT.**
   *
   * Matching rewrites the line's account and amount, and `approveBill` builds
   * its entry FROM those lines — so matching an already-approved bill changes
   * what the bill says without changing what was posted. The delivery ends up
   * both expensed (by the original coding) and capitalised (by the receipt),
   * which is precisely the "both capitalise" failure ADR 0012 opens with, and
   * the bill's own lines stop reconciling to its own journal entry.
   */
  const bill = await tx.query.bills.findFirst({
    where: and(
      eq(schema.bills.tenantId, ctx.tenantId),
      eq(schema.bills.id, line.billId),
    ),
    columns: { status: true, entityId: true },
  });
  if (!bill) throw new InventoryError("NOT_FOUND", "bill");
  if (bill.status !== "draft" && bill.status !== "awaiting_approval") {
    throw new InventoryError(
      "BILL_POSTED",
      "that bill is already approved — match the delivery before approving it",
    );
  }

  /**
   * **THE INVOICE AMOUNT, RECONSTRUCTED** — because matching rewrites the line
   * and may already have done so.
   *
   * A matched line carries the receipts' total and its sibling carries the
   * rest, so the two together are what the vendor charged. Reading only the
   * line would shrink the bill a little more on every re-match; the first
   * version of this validated against it and broke both idempotency and
   * matching a line one delivery at a time.
   */
  const varianceDescription = `Price difference against delivery — ${line.description}`;
  const priorSiblings = await tx
    .select({ amountCents: schema.billLines.amountCents })
    .from(schema.billLines)
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.billId, line.billId),
        eq(schema.billLines.description, varianceDescription),
      ),
    );
  const invoiceTotalCents =
    line.amountCents + priorSiblings.reduce((sum, r) => sum + r.amountCents, 0);

  // Only the receipts this call names. Reusing the screen's paginated query
  // meant that past its limit the newest deliveries were invisible and the
  // caller got a false "already fully invoiced".
  const open = await unbilledReceipts(tx, ctx.tenantId, {
    movementIds: input.matches.map((m) => m.movementId),
    exceptBillLineId: input.billLineId,
  });
  const byId = new Map(open.map((r) => [r.movementId, r]));

  for (const match of input.matches) {
    const receipt = byId.get(match.movementId);
    if (!receipt) {
      throw new InventoryError(
        "NOT_FOUND",
        "that delivery is already fully invoiced, or carries no cost to settle",
      );
    }
    if (match.quantityMatched <= 0) {
      throw new InventoryError("ZERO_QUANTITY", "match a quantity above zero");
    }
    if (round4(match.quantityMatched) > receipt.openQuantity) {
      throw new InventoryError(
        "INSUFFICIENT",
        `that delivery only has ${receipt.openQuantity} ${receipt.unit} left to invoice`,
      );
    }
  }

  // Largest remainder, so the parts sum to the invoice exactly.
  const shares = input.matches.map((match) => {
    const receipt = byId.get(match.movementId)!;
    const receiptShare = Math.round(
      (receipt.costCents * match.quantityMatched) / receipt.quantity,
    );
    return { match, receipt, receiptShare };
  });
  const allocated = allocateByWeight(
    invoiceTotalCents,
    shares.map((s) => s.receiptShare),
  );

  /**
   * **A BILL CANNOT SETTLE ANOTHER COMPANY'S DELIVERY.**
   *
   * The receipt capitalised into whichever company its location belongs to; the
   * bill clears in `bill.entityId`. If those differ the two halves land in
   * different books and neither GRNI can ever net — which is the same defect
   * `resolveMovementEntity` fixes on the posting side, arriving from the other
   * end.
   */
  for (const match of input.matches) {
    const receipt = byId.get(match.movementId)!;
    const receiptEntity = await resolveMovementEntity(
      tx,
      ctx.tenantId,
      receipt.locationAssetId,
    );
    if (receiptEntity !== bill.entityId) {
      throw new InventoryError(
        "ENTITY_MISMATCH",
        "That delivery belongs to a different company from this bill.",
      );
    }
  }


  const grniAccountId = await resolveGrniAccount(tx, ctx.tenantId);
  const accounts = await resolveInventoryAccounts(tx, ctx.tenantId);

  /**
   * **UPSERT, NOT insert-or-ignore.** A second match against the same pair is a
   * correction to the first — the schema comment says so — and
   * `onConflictDoNothing` made it a silent no-op that still reported success
   * and still re-pointed the line. Re-matching part of a delivery left the
   * allocations claiming the old quantity while the line claimed the new one.
   */
  for (let i = 0; i < shares.length; i += 1) {
    const { match, receiptShare } = shares[i];
    await tx
      .insert(schema.billLineStockAllocations)
      .values({
        tenantId: ctx.tenantId,
        billLineId: input.billLineId,
        inventoryMovementId: match.movementId,
        quantityMatched: match.quantityMatched,
        receiptCostCents: receiptShare,
        invoiceCostCents: allocated[i],
      })
      .onConflictDoUpdate({
        target: [
          schema.billLineStockAllocations.tenantId,
          schema.billLineStockAllocations.billLineId,
          schema.billLineStockAllocations.inventoryMovementId,
        ],
        set: {
          quantityMatched: match.quantityMatched,
          receiptCostCents: receiptShare,
          invoiceCostCents: allocated[i],
        },
      });
  }

  /**
   * **THE LINE IS REBUILT FROM EVERY ALLOCATION ON IT, not from this call.**
   *
   * Matching one line against two deliveries in two calls used to OVERWRITE the
   * line with the second call's total, stranding the first delivery's GRNI
   * credit forever while the allocation table said both were invoiced.
   */
  const onLine = await tx
    .select({
      receiptCostCents: schema.billLineStockAllocations.receiptCostCents,
      invoiceCostCents: schema.billLineStockAllocations.invoiceCostCents,
    })
    .from(schema.billLineStockAllocations)
    .where(
      and(
        eq(schema.billLineStockAllocations.tenantId, ctx.tenantId),
        eq(schema.billLineStockAllocations.billLineId, input.billLineId),
      ),
    );
  const lineReceiptTotal = onLine.reduce((sum, r) => sum + r.receiptCostCents, 0);


  /**
   * **SPLIT THE DIFFERENCE BY CAUSE.** The gap between what the invoice charges
   * and what the tickets said has two entirely different meanings, and booking
   * both as a price variance meant an invoice for goods that never arrived was
   * quietly expensed:
   *
   * - **A price difference** — same quantity, different rate — is a real cost
   *   and belongs on the P&L.
   * - **A shortfall** — charged for more than turned up — is not a cost at all.
   *   It is stock the business has paid for and does not have, so it stays in
   *   GRNI as a debit, which is exactly what that account is for and exactly
   *   what the reconciliation is meant to surface.
   */
  const matchedQuantity = input.matches.reduce(
    (sum, m) => sum + m.quantityMatched,
    0,
  );
  const invoiceQuantity = input.invoiceQuantity ?? matchedQuantity;
  const shortQuantity = Math.max(0, round4(invoiceQuantity - matchedQuantity));

  const totalGap = invoiceTotalCents - lineReceiptTotal;
  // The shortfall is valued at the rate the invoice is actually charging, so a
  // short delivery and a price rise on the same invoice each land where they
  // belong rather than netting into one misleading number.
  const invoiceRate =
    invoiceQuantity > 0 ? invoiceTotalCents / invoiceQuantity : 0;
  const shortfallCents =
    shortQuantity > 0 ? Math.round(invoiceRate * shortQuantity) : 0;
  const varianceCents = totalGap - shortfallCents;

  /**
   * **THE LINE IS SPLIT SO THAT GRNI CLEARS EXACTLY.**
   *
   * `approveBill` posts each bill line to its own account at its own amount, so
   * a single line for the invoice total would debit GRNI 6,500 against the
   * 6,000 the receipt credited — and the 500 would sit in GRNI forever, where it
   * means neither "received not invoiced" nor anything else. That is not a
   * rounding difference; it is the price variance with nowhere to go, and ADR
   * 0012 §A.5 says it lands in an account rather than being absorbed.
   *
   * So the matched line carries exactly what the receipts credited, and a
   * sibling line carries the difference. AP is unaffected — the two still sum
   * to the invoice — and the entry `approveBill` builds becomes
   * `Dr GRNI 6,000 / Dr Variance 500 / Cr AP 6,500`.
   *
   * Found by a test that asserted GRNI clears. The test before it asserted only
   * that the variance was CALCULATED, which it was, and which is not the same
   * as it being recorded.
   */
  await tx
    .update(schema.billLines)
    .set({
      accountId: grniAccountId,
      // Receipts PLUS anything charged for and not delivered: the shortfall
      // belongs in GRNI, not on the P&L.
      amountCents: lineReceiptTotal + shortfallCents,
    })
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.id, input.billLineId),
      ),
    );

  /**
   * The variance line is REPLACED, never appended twice. A double-submitted
   * match used to add a second one, inflating both AP and the expense by the
   * variance with no error anywhere — the allocation was conflict-protected and
   * this was not.
   */
  await tx
    .delete(schema.billLines)
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.billId, line.billId),
        eq(schema.billLines.description, varianceDescription),
      ),
    );

  if (varianceCents !== 0) {
    const siblings = await tx
      .select({ lineNo: schema.billLines.lineNo })
      .from(schema.billLines)
      .where(
        and(
          eq(schema.billLines.tenantId, ctx.tenantId),
          eq(schema.billLines.billId, line.billId),
        ),
      );
    const nextLineNo =
      siblings.reduce((max, r) => Math.max(max, r.lineNo), 0) + 1;
    // A NEGATIVE line is legal and is the cheaper-than-quoted case: the schema
    // calls it a credit line, and it credits the variance account instead.
    await tx.insert(schema.billLines).values({
      tenantId: ctx.tenantId,
      billId: line.billId,
      lineNo: nextLineNo,
      description: varianceDescription,
      amountCents: varianceCents,
      accountId: accounts.varianceAccountId,
    });
  }

  return { allocations: shares.length, varianceCents, shortfallCents };
}

/**
 * Split a total across weights so the parts sum to the whole, largest remainder
 * first. The same rule the cash-basis allocator uses, and for the same reason:
 * without it a split in integer cents loses or invents pennies.
 *
 * All-zero weights fall back to an even split, because "two deliveries that both
 * recorded no cost" still has to put the invoice somewhere.
 */
function allocateByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    const even = Math.floor(total / weights.length);
    const out = weights.map(() => even);
    let left = total - even * weights.length;
    for (let i = 0; left > 0; i += 1, left -= 1) out[i % out.length] += 1;
    return out;
  }
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map((e) => Math.floor(e));
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/**
 * **UNDO A MATCH**, putting the line back where it was.
 *
 * A person will get a match wrong — the wrong delivery, the wrong quantity, the
 * right delivery on the wrong bill — and until this existed the only way out
 * was SQL. `allocateBillLineToStock` re-codes the line and rewrites its amount,
 * so undoing has to do three things together or it leaves the bill in a state
 * no screen can explain:
 *
 * 1. drop the allocations, so the deliveries go back on the reconciliation;
 * 2. fold the variance sibling's amount back into the line, so the vendor is
 *    still owed exactly what they invoiced;
 * 3. clear the GRNI coding, so the line is uncoded again and `approveBill`
 *    refuses it until somebody says what it was for. **Uncoded is the honest
 *    state** — the alternative is guessing an expense account on the way out.
 *
 * Refuses on an approved bill for the same reason matching does: the entry is
 * already posted and this would change what the bill says without changing what
 * was posted.
 */
export async function unmatchBillLine(
  tx: Tx,
  ctx: InventoryCtx,
  input: { billLineId: string },
): Promise<{ released: number }> {
  if (!allowsWrite(ctx.role, "owner")) {
    throw new InventoryError(
      "FORBIDDEN",
      "only an owner can unpick a bill from stock",
    );
  }

  const line = await tx.query.billLines.findFirst({
    where: and(
      eq(schema.billLines.tenantId, ctx.tenantId),
      eq(schema.billLines.id, input.billLineId),
    ),
  });
  if (!line) throw new InventoryError("NOT_FOUND", "bill line");

  const bill = await tx.query.bills.findFirst({
    where: and(
      eq(schema.bills.tenantId, ctx.tenantId),
      eq(schema.bills.id, line.billId),
    ),
    columns: { status: true },
  });
  if (!bill) throw new InventoryError("NOT_FOUND", "bill");
  if (bill.status !== "draft" && bill.status !== "awaiting_approval") {
    throw new InventoryError(
      "BILL_POSTED",
      "that bill is already approved — its entry has posted, so the match cannot be unpicked",
    );
  }

  const dropped = await tx
    .delete(schema.billLineStockAllocations)
    .where(
      and(
        eq(schema.billLineStockAllocations.tenantId, ctx.tenantId),
        eq(schema.billLineStockAllocations.billLineId, input.billLineId),
      ),
    )
    .returning({ id: schema.billLineStockAllocations.id });

  // The sibling's amount comes home, so the bill still totals the invoice.
  const varianceDescription = `Price difference against delivery — ${line.description}`;
  const siblings = await tx
    .delete(schema.billLines)
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.billId, line.billId),
        eq(schema.billLines.description, varianceDescription),
      ),
    )
    .returning({ amountCents: schema.billLines.amountCents });
  const returned = siblings.reduce((sum, r) => sum + r.amountCents, 0);

  await tx
    .update(schema.billLines)
    .set({ accountId: null, amountCents: line.amountCents + returned })
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.id, input.billLineId),
      ),
    );

  return { released: dropped.length };
}

export interface MatchableBillLine {
  billLineId: string;
  billId: string;
  vendorName: string;
  billNumber: string;
  billDate: string;
  description: string;
  /** What the vendor is charging for this line, including any variance sibling. */
  invoiceCents: number;
  /** How much of it is already matched to deliveries. */
  matchedCents: number;
  matchedCount: number;
}

/**
 * **BILL LINES THAT COULD BE A DELIVERY**, for the matching screen.
 *
 * Only DRAFT and awaiting-approval bills: once a bill is approved its entry has
 * posted, and matching then would change what the bill says without changing
 * what was posted — `allocateBillLineToStock` refuses it, so offering it here
 * would be offering a button that cannot work.
 *
 * Lines already coded to something else are still listed, because "this was
 * coded to Feed Expense and should have been a delivery" is exactly the
 * correction somebody opens this screen to make. What is NOT listed is a line
 * on a bill nobody can still change.
 */
export async function matchableBillLines(
  tx: Tx,
  tenantId: string,
  limit = 100,
): Promise<MatchableBillLine[]> {
  const rows = await tx
    .select({
      billLineId: schema.billLines.id,
      billId: schema.bills.id,
      vendorName: schema.vendors.name,
      billNumber: schema.bills.billNumber,
      billDate: schema.bills.billDate,
      description: schema.billLines.description,
      amountCents: schema.billLines.amountCents,
      matchedCents: sql<string>`coalesce((
        select sum(a.receipt_cost_cents) from bill_line_stock_allocations a
         where a.tenant_id = ${schema.billLines.tenantId}
           and a.bill_line_id = ${schema.billLines.id}
      ), 0)`,
      matchedCount: sql<string>`coalesce((
        select count(*) from bill_line_stock_allocations a
         where a.tenant_id = ${schema.billLines.tenantId}
           and a.bill_line_id = ${schema.billLines.id}
      ), 0)`,
      siblingCents: sql<string>`coalesce((
        select sum(v.amount_cents) from bill_lines v
         where v.tenant_id = ${schema.billLines.tenantId}
           and v.bill_id = ${schema.billLines.billId}
           and v.description = 'Price difference against delivery — ' || ${schema.billLines.description}
      ), 0)`,
    })
    .from(schema.billLines)
    .innerJoin(
      schema.bills,
      and(
        eq(schema.bills.tenantId, schema.billLines.tenantId),
        eq(schema.bills.id, schema.billLines.billId),
      ),
    )
    .innerJoin(
      schema.vendors,
      and(
        eq(schema.vendors.tenantId, schema.bills.tenantId),
        eq(schema.vendors.id, schema.bills.vendorId),
      ),
    )
    .where(
      and(
        eq(schema.billLines.tenantId, tenantId),
        inArray(schema.bills.status, ["draft", "awaiting_approval"]),
        // The variance siblings this pack writes are not themselves matchable.
        sql`${schema.billLines.description} not like 'Price difference against delivery — %'`,
      ),
    )
    .orderBy(asc(schema.bills.billDate))
    .limit(limit);

  return rows.map((r) => ({
    billLineId: r.billLineId,
    billId: r.billId,
    vendorName: r.vendorName,
    billNumber: r.billNumber,
    billDate: r.billDate,
    description: r.description,
    // The line plus its sibling is what the vendor actually charged — the same
    // reconstruction `allocateBillLineToStock` does, and for the same reason.
    invoiceCents: r.amountCents + Number(r.siblingCents),
    matchedCents: Number(r.matchedCents),
    matchedCount: Number(r.matchedCount),
  }));
}

export interface GrniPosition {
  /** What the deliveries say is waiting for an invoice — the WORKING. */
  awaitingInvoiceCents: number;
  awaitingInvoiceCount: number;
  /** What the account actually holds — the ANSWER. Credits are positive here. */
  accountCents: number;
  /**
   * Working less answer. **Nearly always the deliveries that arrived before
   * posting was switched on**, which never credited anything and never will —
   * turning it on does not backfill. Anything else is worth finding.
   */
  differenceCents: number;
}

/**
 * The GRNI position, **from both ends**.
 *
 * The account is the answer and the deliveries are the working, and the whole
 * point is COMPARING them — an earlier version of this computed only the
 * working, and a doc comment claimed the comparison it never made. On a farm
 * that had just switched posting on it reported "$700 is what Goods Received
 * Not Invoiced should be holding" about an account holding nothing, because
 * every one of those deliveries predated the switch.
 *
 * Reporting one number and calling it both is exactly the failure this pack
 * keeps writing tests against.
 */
export async function grniPosition(
  tx: Tx,
  tenantId: string,
): Promise<GrniPosition> {
  const open = await unbilledReceipts(tx, tenantId, { limit: 1000 });
  const awaitingInvoiceCents = open.reduce((sum, r) => sum + r.openCostCents, 0);

  let accountCents = 0;
  try {
    const accountId = await resolveGrniAccount(tx, tenantId);
    const rows = await tx
      .select({ amountCents: schema.journalLines.amountCents })
      .from(schema.journalLines)
      .where(
        and(
          eq(schema.journalLines.tenantId, tenantId),
          eq(schema.journalLines.accountId, accountId),
        ),
      );
    // A liability is credited, and credits are negative in the ledger's own
    // convention — flipped here so the card can read it beside the working.
    accountCents = -rows.reduce((sum, r) => sum + r.amountCents, 0);
  } catch {
    // No GRNI account: a tenant with no books. The working still stands, and
    // the answer is genuinely zero rather than unknown.
    accountCents = 0;
  }

  return {
    awaitingInvoiceCents,
    awaitingInvoiceCount: open.length,
    accountCents,
    differenceCents: awaitingInvoiceCents - accountCents,
  };
}
