import "server-only";
import { and, asc, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { schema, type Tx } from "@/db";
import type { Entity } from "@/db/schema";
import { LedgerError } from "./errors";
import { requireOwnerRole } from "./guards";
import type { LedgerCtx } from "./types";

/**
 * Legal entities inside a tenant, and the scope every report must state.
 * See docs/decisions/0010-entities-inside-a-tenant.md.
 */

/**
 * Which books a report is about. REQUIRED wherever it appears — never
 * optional, never defaulted.
 *
 * THIS IS THE WHOLE DEFENCE AGAINST THE FAILURE ADR 0010 NAMES: a report that
 * forgets its entity is silently wrong across entities and perfectly correct
 * for the single-entity tenant it is being tested on, which is the worst
 * possible failure signature. A discriminated union rather than
 * `entityId?: string` where absent means everything, because `undefined` is
 * precisely what a caller forgets, while `{ kind: "combined" }` is something
 * somebody had to type. Same move `listStructures` made when it shipped
 * unfiltered — an optional argument lets the next caller reintroduce the bug by
 * not thinking about it; a required one makes not thinking about it a compile
 * error.
 *
 * "COMBINED", NOT "CONSOLIDATED", and the name is doing work. It is the plain
 * sum across entities with NO eliminations. Today that is also the consolidated
 * figure, because intercompany pairs do not exist yet (slice 2). When they do,
 * "combined" is still an honest name for a number that has eliminated nothing,
 * so nothing here has to be renamed or quietly redefined — the consolidated
 * report arrives beside it as its own kind.
 */
export type EntityScope =
  | { kind: "one"; entityId: string }
  | { kind: "combined" };

/**
 * The SQL predicate for a scope, or undefined for combined.
 *
 * Callers spread this into their existing condition list. It defaults to
 * `journal_entries.entity_id`, because most reports are ledger reports and the
 * entity is on the ENTRY, never on the line (ADR 0010) — which is what keeps
 * every entry balanced on its own.
 *
 * The `column` argument is for the DOCUMENT reports: A/R aging reads
 * `invoices.entity_id`, A/P aging reads `bills.entity_id`, and the tax summary
 * reads both an invoice column and the ledger. One helper rather than three, so
 * "combined means no predicate" is decided in exactly one place — a report that
 * hand-rolled `eq(...)` would have to remember that on its own.
 */
export function entityScopeCondition(
  scope: EntityScope,
  column: PgColumn = schema.journalEntries.entityId,
): SQL | undefined {
  return scope.kind === "one" ? eq(column, scope.entityId) : undefined;
}

/**
 * For stamping a report footer and a CSV: "Maple Street LLC", or
 * "All companies (combined)".
 *
 * COMPANY, not "entity", everywhere a person reads it. "Legal entity" is the
 * accountant's word for it and the code's; nobody running ten LLCs calls them
 * entities. The same split `obligationFor` makes — the stored concept and the
 * rendered word are allowed to differ.
 */
export function entityScopeLabel(
  scope: EntityScope,
  entities: Array<Pick<Entity, "id" | "name">>,
): string {
  if (scope.kind === "combined") return "All companies (combined)";
  return entities.find((e) => e.id === scope.entityId)?.name ?? "Unknown company";
}

export async function listEntities(
  tx: Tx,
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Entity[]> {
  return tx.query.entities.findMany({
    where: opts.includeInactive
      ? eq(schema.entities.tenantId, tenantId)
      : and(
          eq(schema.entities.tenantId, tenantId),
          eq(schema.entities.isActive, true),
        ),
    orderBy: asc(schema.entities.name),
  });
}

/**
 * The entity an entry lands in when nothing chose one.
 *
 * NOT A POSTING FALLBACK ANY MORE. Since invoices, bills and bank accounts
 * carry their own company, every entry reads it off the document that caused
 * it. This is now only the answer to "which company when NOBODY has said" — the
 * value a new draft, a new register or a template with no company of its own
 * starts from. It is still never called inside `postEntry`: a silent default
 * there would be a wrong company with nothing to grep for.
 *
 * Throws rather than inventing a row — the `SETTINGS_MISSING` shape. Every
 * tenant is given one by `drizzle/0142` and by `provisionEntity`.
 */
export async function getDefaultEntityId(
  tx: Tx,
  tenantId: string,
): Promise<string> {
  const row = await tx.query.entities.findFirst({
    where: and(
      eq(schema.entities.tenantId, tenantId),
      eq(schema.entities.isDefault, true),
    ),
    columns: { id: true },
  });
  if (!row) {
    throw new LedgerError(
      "ENTITY_MISSING",
      `tenant ${tenantId} has no default entity`,
    );
  }
  return row.id;
}

/**
 * The company that owns the register clearing this ledger account, or the
 * tenant's default when the account is not a register at all.
 *
 * A receipt paid from an account, or any other write whose only clue about the
 * company is which account the money left, resolves it here. The posting engine
 * refuses a mismatch anyway (`assertNoForeignRegisters`), so this is about
 * getting it RIGHT rather than about being allowed to.
 */
export async function entityForRegisterAccount(
  tx: Tx,
  tenantId: string,
  accountId: string,
): Promise<string> {
  const row = await tx.query.bankAccounts.findFirst({
    where: and(
      eq(schema.bankAccounts.tenantId, tenantId),
      eq(schema.bankAccounts.accountId, accountId),
    ),
    columns: { entityId: true },
  });
  return row?.entityId ?? (await getDefaultEntityId(tx, tenantId));
}

/**
 * The entity a document's ledger entries already landed in, or null if it has
 * none yet.
 *
 * A DOCUMENT'S ENTRIES ALL BELONG TO ONE COMPANY. An invoice issued in Maple
 * Street's books whose payment posts into Oak Row's leaves both AR balances
 * wrong while the tenant as a whole still ties out — the exact failure mode
 * that only shows up on a client with two entities.
 *
 * It is reachable today even though nothing chooses an entity yet: `postEntry`
 * callers that cannot choose pass the tenant's DEFAULT, and the default can be
 * moved. Issue an invoice, move the default, take the payment, and the two legs
 * are in different companies. So this is a live guard, not headroom.
 *
 * SUPERSEDED for invoices, bills and bank rows — they carry their own company
 * now and their entries read it off the row. The assets pack is the last
 * caller, because a fixed asset has no company column yet and its depreciation
 * schedule still has to land every month where the first entry did.
 */
export async function entityOfDocument(
  tx: Tx,
  tenantId: string,
  source: "invoice" | "bill" | "bank_import" | "depreciation" | "opening_balance",
  sourceId: string,
): Promise<string | null> {
  const row = await tx.query.journalEntries.findFirst({
    where: and(
      eq(schema.journalEntries.tenantId, tenantId),
      eq(schema.journalEntries.source, source),
      eq(schema.journalEntries.sourceId, sourceId),
    ),
    columns: { entityId: true },
    orderBy: asc(schema.journalEntries.createdAt),
  });
  return row?.entityId ?? null;
}

/**
 * `entityOfDocument`, falling back to the tenant default for a first entry.
 *
 * ONLY THE ASSETS PACK STILL USES THIS. Invoices, bills and bank accounts now
 * carry their own company, so their entries read it off the document; a fixed
 * asset does not yet, and its depreciation schedule must still land every month
 * in whichever company the first entry did. Give `assets` an `entity_id` and
 * this loses its last caller.
 */
export async function entityForDocument(
  tx: Tx,
  tenantId: string,
  source: "invoice" | "bill" | "bank_import" | "depreciation" | "opening_balance",
  sourceId: string,
): Promise<string> {
  return (
    (await entityOfDocument(tx, tenantId, source, sourceId)) ??
    (await getDefaultEntityId(tx, tenantId))
  );
}

/**
 * Turn a URL parameter into a scope.
 *
 * An UNREADABLE or UNKNOWN id REFUSES. It deliberately does not fall back the
 * way `basis` does: an unparseable basis has a safe answer (accrual is the
 * ledger as posted), whereas quietly substituting the default entity — or
 * everything — for an entity the reader named produces a statement that is
 * wrong about which company it describes while looking entirely normal.
 *
 * Absent means: the tenant's only entity when it has one, combined when it has
 * several. So the single-entity client never sees the concept, and a
 * multi-entity client's unscoped visit is labelled "All entities (combined)"
 * rather than silently showing one company's books.
 */
export async function resolveEntityScope(
  tx: Tx,
  tenantId: string,
  requested: string | undefined,
  entities: Array<Pick<Entity, "id">>,
): Promise<EntityScope> {
  if (!requested || requested === "combined") {
    return entities.length === 1
      ? { kind: "one", entityId: entities[0].id }
      : { kind: "combined" };
  }
  if (!entities.some((e) => e.id === requested)) {
    throw new LedgerError("ENTITY_NOT_FOUND", `entity ${requested} not found`);
  }
  return { kind: "one", entityId: requested };
}

/**
 * Everything a report needs to know about companies, in one call — because a
 * report page that has to remember three steps is a report page that forgets
 * one of them.
 *
 * `stampLabel` is undefined for a single-entity tenant, so the footer, the CSV
 * and the filename are all exactly what they were: the client who has one
 * company never learns the word. The moment there are two it appears
 * everywhere, on the same rule the basis stamp follows.
 */
export async function resolveReportEntity(
  tx: Tx,
  tenantId: string,
  requested: string | undefined,
): Promise<{
  scope: EntityScope;
  entities: Entity[];
  /** Show the picker at all? Only once there is a choice to make. */
  showPicker: boolean;
  /** For the report footer and the CSV, or undefined when there is one company. */
  stampLabel: string | undefined;
}> {
  // INACTIVE ONES INCLUDED, unlike the journal form's picker. You cannot post
  // into a deactivated company, but its books do not stop existing — a closed
  // LLC still has last year's balance sheet, and a return may still be filed
  // for it. Excluding them would make those books unreachable and turn a saved
  // report link into a 404.
  const entities = await listEntities(tx, tenantId, { includeInactive: true });
  const scope = await resolveEntityScope(tx, tenantId, requested, entities);
  const showPicker = entities.length > 1;
  return {
    scope,
    entities,
    showPicker,
    stampLabel: showPicker ? entityScopeLabel(scope, entities) : undefined,
  };
}

/**
 * One default entity per tenant, named after the tenant. Idempotent, and
 * therefore also the backfill path for a tenant that predates `drizzle/0142`.
 * Runs with the chart of accounts.
 */
export async function provisionEntity(
  tx: Tx,
  tenantId: string,
  tenantName: string,
): Promise<{ created: boolean }> {
  const existing = await tx.query.entities.findFirst({
    where: eq(schema.entities.tenantId, tenantId),
    columns: { id: true },
  });
  if (existing) return { created: false };
  const rows = await tx
    .insert(schema.entities)
    .values({ tenantId, name: tenantName, isDefault: true })
    .onConflictDoNothing()
    .returning({ id: schema.entities.id });
  return { created: rows.length > 0 };
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new LedgerError("ENTITY_NAME_INVALID", "an entity needs a name");
  return trimmed;
}

export async function createEntity(
  tx: Tx,
  ctx: LedgerCtx,
  input: { name: string; legalName?: string },
): Promise<Entity> {
  requireOwnerRole(ctx);
  const name = cleanName(input.name);
  const rows = await tx
    .insert(schema.entities)
    .values({
      tenantId: ctx.tenantId,
      name,
      legalName: input.legalName?.trim() ?? "",
      // Never the default: the first entity holds every entry posted so far,
      // and moving the default is a separate, deliberate act.
      isDefault: false,
    })
    .onConflictDoNothing()
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("ENTITY_NAME_TAKEN", `entity named ${name} exists`);
  }
  return rows[0];
}

export async function updateEntity(
  tx: Tx,
  ctx: LedgerCtx,
  input: {
    entityId: string;
    name?: string;
    legalName?: string;
    isActive?: boolean;
  },
): Promise<Entity> {
  requireOwnerRole(ctx);
  const entity = await tx.query.entities.findFirst({
    where: and(
      eq(schema.entities.tenantId, ctx.tenantId),
      eq(schema.entities.id, input.entityId),
    ),
  });
  if (!entity) {
    throw new LedgerError("ENTITY_NOT_FOUND", `entity ${input.entityId} not found`);
  }
  // Deactivating the default would leave new entries with nowhere to land.
  if (input.isActive === false && entity.isDefault) {
    throw new LedgerError(
      "ENTITY_IS_DEFAULT",
      "the default entity cannot be deactivated",
    );
  }
  const rows = await tx
    .update(schema.entities)
    .set({
      name: input.name === undefined ? entity.name : cleanName(input.name),
      legalName: input.legalName?.trim() ?? entity.legalName,
      isActive: input.isActive ?? entity.isActive,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.entities.tenantId, ctx.tenantId),
        eq(schema.entities.id, input.entityId),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("ENTITY_NOT_FOUND", `entity ${input.entityId} not found`);
  }
  return rows[0];
}

/**
 * Move the default. Two statements, not one: the partial unique index allows a
 * single default per tenant, so the old one must be cleared before the new one
 * is set or the UPDATE trips its own constraint.
 */
export async function setDefaultEntity(
  tx: Tx,
  ctx: LedgerCtx,
  entityId: string,
): Promise<void> {
  requireOwnerRole(ctx);
  const entity = await tx.query.entities.findFirst({
    where: and(
      eq(schema.entities.tenantId, ctx.tenantId),
      eq(schema.entities.id, entityId),
    ),
  });
  if (!entity) {
    throw new LedgerError("ENTITY_NOT_FOUND", `entity ${entityId} not found`);
  }
  if (!entity.isActive) {
    throw new LedgerError("ENTITY_INACTIVE", `entity ${entityId} is inactive`);
  }
  if (entity.isDefault) return;
  await tx
    .update(schema.entities)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.entities.tenantId, ctx.tenantId),
        eq(schema.entities.isDefault, true),
      ),
    );
  await tx
    .update(schema.entities)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.entities.tenantId, ctx.tenantId),
        eq(schema.entities.id, entityId),
      ),
    );
}
