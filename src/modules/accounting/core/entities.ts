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
 * sum across entities with NO eliminations, and slice 3 did not redefine it:
 * `consolidated` arrived BESIDE it as a third kind. A report that quietly
 * started eliminating under the name "combined" would change what every saved
 * report link and every already-exported file means.
 *
 * CONSOLIDATED HAS NO `entityId`, and that is deliberate rather than an
 * omission. Eliminating one side of an intercompany pair while keeping the
 * other leaves that company's books short by the amount — so a consolidated
 * single company is not a thing, and the type says so.
 */
export type EntityScope =
  | { kind: "one"; entityId: string }
  | { kind: "combined" }
  | { kind: "consolidated" };

/**
 * The scopes that are a plain ROW FILTER, with nothing to eliminate.
 *
 * THIS TYPE IS THE WHOLE DEFENCE OF SLICE 3, the way the required argument was
 * the defence of slice 1. Elimination is a LINE-level exclusion, but a scope has
 * so far been an ENTRY-level predicate — so a consolidated scope handed to
 * `entityScopeCondition` would eliminate nothing and produce a statement that
 * looks right, balances, and double-counts every intercompany transaction.
 * Narrowing that function's parameter makes it a COMPILE ERROR to hand it one:
 * every existing call site had to say what it does about consolidation, and so
 * does the next report anybody writes.
 */
export type FilterScope = Exclude<EntityScope, { kind: "consolidated" }>;

/** Does a report offer the consolidated scope at all? Stated, never defaulted. */
export type Consolidation = "offered" | "declined";

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
 *
 * IT TAKES A `FilterScope`, NOT AN `EntityScope`. A ledger report reading
 * journal lines wants `ledgerScopeConditions` in `consolidation.ts`, which
 * returns this predicate AND the elimination alongside it.
 */
export function entityScopeCondition(
  scope: FilterScope,
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
  // The two sit side by side and the difference between them is the whole
  // feature, so the label says which one it is rather than leaving the reader
  // to infer it from the numbers.
  if (scope.kind === "consolidated") return "All companies (consolidated)";
  return entities.find((e) => e.id === scope.entityId)?.name ?? "Unknown company";
}

/**
 * The date EVERY company is locked through, or null if any one of them is not.
 *
 * The honest reading of "the books are closed through X" once there are several
 * sets of books: the point before which nothing can be posted ANYWHERE. It is
 * the earliest of the companies' own dates, and null the moment one has never
 * been closed — because a group where Oak is still open is not a group that is
 * closed through anything, however tidy Maple's June looks.
 *
 * The alternative — showing the latest, or the default company's — is a number
 * that reads as a guarantee the books do not give.
 */
export function groupClosedThrough(
  entities: Array<Pick<Entity, "closedThrough">>,
): string | null {
  if (entities.length === 0) return null;
  let earliest: string | null = null;
  for (const e of entities) {
    if (!e.closedThrough) return null;
    if (!earliest || e.closedThrough < earliest) earliest = e.closedThrough;
  }
  return earliest;
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
 * `entityOfDocument` and `entityForDocument` lived here from slice 1 until
 * `drizzle/0154`, and their removal is the end of ADR 0010's list.
 *
 * They answered "which company did this document's entries land in", by reading
 * the FIRST entry and falling back to the tenant default. That was the right
 * answer while nothing carried a company of its own — and a trap, because the
 * fallback picks whatever the default happened to be at the moment somebody
 * first pressed Post. Invoices, bills and registers stopped needing it in slice
 * 1b; fixed assets were the last caller, and now carry `assets.entity_id`.
 *
 * Nothing infers a company from history any more. Every document states one.
 */

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
 *
 * `consolidated` follows the SAME two rules. On a one-company tenant it means
 * that company — there is nothing to consolidate and the client never learns
 * the word. On a report that DECLINES consolidation it refuses, exactly as an
 * unknown id does, rather than quietly answering with the combined figures
 * under a name the reader chose for the difference.
 */
export async function resolveEntityScope(
  tx: Tx,
  tenantId: string,
  requested: string | undefined,
  entities: Array<Pick<Entity, "id">>,
  consolidation: Consolidation,
): Promise<EntityScope> {
  const only = entities.length === 1 ? entities[0].id : undefined;
  if (!requested || requested === "combined") {
    return only ? { kind: "one", entityId: only } : { kind: "combined" };
  }
  if (requested === "consolidated") {
    if (only) return { kind: "one", entityId: only };
    if (consolidation === "declined") {
      throw new LedgerError(
        "SCOPE_NOT_OFFERED",
        "this report does not offer a consolidated scope",
      );
    }
    return { kind: "consolidated" };
  }
  if (!entities.some((e) => e.id === requested)) {
    throw new LedgerError("ENTITY_NOT_FOUND", `entity ${requested} not found`);
  }
  return { kind: "one", entityId: requested };
}

export interface ReportEntityView<S extends EntityScope = EntityScope> {
  scope: S;
  entities: Entity[];
  /** Show the picker at all? Only once there is a choice to make. */
  showPicker: boolean;
  /** Does the picker list "All companies (consolidated)" beside combined? */
  offerConsolidated: boolean;
  /** For the report footer and the CSV, or undefined when there is one company. */
  stampLabel: string | undefined;
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
 *
 * THE `consolidation` ARGUMENT IS REQUIRED, and it is what the returned
 * `scope`'s TYPE depends on. A report that declines gets a `FilterScope` back
 * and therefore type-checks against `entityScopeCondition`; a report that
 * offers gets the full `EntityScope` and can only reach the ledger through
 * `ledgerScopeConditions`, which eliminates. Which reports decline, and why
 * each one does, is written down in docs/modules/accounting.md.
 */
export async function resolveReportEntity(
  tx: Tx,
  tenantId: string,
  requested: string | undefined,
  consolidation: "offered",
): Promise<ReportEntityView<EntityScope>>;
export async function resolveReportEntity(
  tx: Tx,
  tenantId: string,
  requested: string | undefined,
  consolidation: "declined",
): Promise<ReportEntityView<FilterScope>>;
export async function resolveReportEntity(
  tx: Tx,
  tenantId: string,
  requested: string | undefined,
  consolidation: Consolidation,
): Promise<ReportEntityView> {
  // INACTIVE ONES INCLUDED, unlike the journal form's picker. You cannot post
  // into a deactivated company, but its books do not stop existing — a closed
  // LLC still has last year's balance sheet, and a return may still be filed
  // for it. Excluding them would make those books unreachable and turn a saved
  // report link into a 404.
  const entities = await listEntities(tx, tenantId, { includeInactive: true });
  const scope = await resolveEntityScope(
    tx,
    tenantId,
    requested,
    entities,
    consolidation,
  );
  const showPicker = entities.length > 1;
  return {
    scope,
    entities,
    showPicker,
    offerConsolidated: showPicker && consolidation === "offered",
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
