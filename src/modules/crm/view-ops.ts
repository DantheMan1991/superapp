import "server-only";
import { and, asc, desc, eq, gt, gte, ilike, lt, lte, ne, not, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { CrmSavedView } from "@/db/schema";
import { CrmError } from "./core/errors";
import {
  BUILT_IN_VIEWS,
  builtInView,
  conditionProblem,
  filterField,
  parseFilter,
  parseSort,
  resolveBuiltIn,
  resolveDateValue,
  type FilterCondition,
  type ViewSort,
} from "./core/views";

/**
 * Saved views: compiling them, and storing them.
 *
 * THE COMPILER IS THE SECURITY-INTERESTING PART OF THIS FILE. A filter arrives
 * as jsonb that a browser once sent, and it ends up in a WHERE clause. Two
 * properties keep that safe, and neither is optional:
 *
 *   1. **The column comes from the registry, never from the input.** A stored
 *      condition names a FIELD KEY; `core/views.ts` maps that key to a drizzle
 *      column object. An unknown key has no column and the condition is
 *      dropped, so a column name cannot arrive from outside the codebase.
 *   2. **The value is always a bound parameter.** Every branch below hands the
 *      value to a drizzle helper — `eq`, `ilike`, `gte` — which parameterises
 *      it. Nothing here concatenates a value into SQL text, and the one place
 *      that builds a LIKE pattern escapes the wildcards first.
 *
 * A filter is a CONVENIENCE OVER ROWS ALREADY PERMITTED. It runs inside the
 * caller's transaction, so RLS has removed what they may not see before any of
 * this applies. That is why a dropped condition — which widens the result — is
 * safe here, and it is the reason a shared view can be shared without anybody
 * auditing it.
 */

/* -- Compiling ------------------------------------------------------------ */

/** The registry's field keys, mapped to the columns they actually mean. */
function columnFor(key: string) {
  switch (key) {
    case "name":
      return schema.parties.displayName;
    case "kind":
      return schema.parties.kind;
    case "active":
      return schema.parties.isActive;
    case "created":
      return schema.parties.createdAt;
    case "stage":
      return schema.crmPartyDetails.lifecycleStage;
    case "lead_source":
      return schema.crmPartyDetails.source;
    case "assigned":
      return schema.crmPartyDetails.ownerClerkUserId;
    case "visibility":
      return schema.crmPartyDetails.visibility;
    default:
      return null;
  }
}

/** One `%term%` fragment with LIKE's own wildcards escaped, bound as a param. */
function contains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Validated conditions as drizzle predicates.
 *
 * `now` is passed in so a relative date resolves once for the whole query and
 * so the sentence describing a view cannot disagree with the rows it returned.
 *
 * A CONDITION THAT DOES NOT COMPILE IS DROPPED rather than throwing, matching
 * `parseFilter` — and both are only safe because dropping widens. If a future
 * change makes any condition here NARROW the permitted set rather than the
 * displayed set, this rule has to be revisited first.
 */
export function compileConditions(
  conditions: readonly FilterCondition[],
  now: Date,
): SQL[] {
  const out: SQL[] = [];

  for (const condition of conditions) {
    if (conditionProblem(condition) !== null) continue;
    const field = filterField(condition.field);
    const column = columnFor(condition.field);
    if (!field || !column) continue;

    if (field.type === "date") {
      const at = resolveDateValue(condition.value, now);
      if (!at) continue;
      switch (condition.operator) {
        case "less_than":
          out.push(lt(column, at));
          break;
        case "greater_than":
          out.push(gt(column, at));
          break;
        case "less_or_equal":
          out.push(lte(column, at));
          break;
        case "greater_or_equal":
          out.push(gte(column, at));
          break;
      }
      continue;
    }

    if (field.type === "boolean") {
      out.push(eq(column, condition.value === "true"));
      continue;
    }

    switch (condition.operator) {
      case "equals":
        out.push(eq(column, condition.value));
        break;
      case "not_equals":
        // `<>` is NULL for a NULL column, so a record CRM has never been asked
        // about would vanish from "stage is not lead" — which reads as data
        // loss rather than a filter. Spelled to keep the unknowns.
        out.push(
          or(ne(column, condition.value), sql`${column} is null`) as SQL,
        );
        break;
      case "contains":
        out.push(ilike(column, contains(condition.value)));
        break;
      case "not_contains":
        out.push(
          or(
            not(ilike(column, contains(condition.value))),
            sql`${column} is null`,
          ) as SQL,
        );
        break;
      case "starts_with":
        out.push(ilike(column, `${contains(condition.value).slice(1)}`));
        break;
    }
  }

  return out;
}

/** The ORDER BY for a view's sort, with a stable tiebreak. */
export function compileSort(sort: ViewSort): SQL[] {
  const direction = sort.direction === "desc" ? desc : asc;
  const primary =
    sort.field === "name"
      ? // Case-insensitive, so "acme" and "Acme" do not split the list.
        (sql`lower(${schema.parties.displayName})` as SQL)
      : sort.field === "created"
        ? (schema.parties.createdAt as unknown as SQL)
        : (schema.crmPartyDetails.lifecycleStage as unknown as SQL);
  // The id breaks ties, so paging cannot show one record twice and skip
  // another — two records with the same name would otherwise order
  // arbitrarily, and differently on each page request.
  return [direction(primary), asc(schema.parties.id)];
}

/* -- Stored views --------------------------------------------------------- */

export interface ResolvedView {
  id: string;
  name: string;
  isBuiltIn: boolean;
  isShared: boolean;
  isMine: boolean;
  conditions: FilterCondition[];
  sort: ViewSort;
}

/**
 * Every view the caller can choose from: the built-ins, then their own and
 * anything shared.
 *
 * Built-ins come first and always exist. They are code rather than seeded rows
 * — see `BUILT_IN_VIEWS` — so a tenant cannot delete one and a new default
 * arrives for everybody at once.
 */
export async function listViews(
  tx: Tx,
  tenantId: string,
  clerkUserId: string,
  entityType = "party",
): Promise<ResolvedView[]> {
  const saved = await tx
    .select()
    .from(schema.crmSavedViews)
    .where(
      and(
        eq(schema.crmSavedViews.tenantId, tenantId),
        eq(schema.crmSavedViews.entityType, entityType),
      ),
    )
    .orderBy(asc(schema.crmSavedViews.name));

  return [
    ...BUILT_IN_VIEWS.map((view) => ({
      id: view.id,
      name: view.name,
      isBuiltIn: true,
      isShared: true,
      isMine: false,
      conditions: resolveBuiltIn(view, clerkUserId),
      sort: view.sort,
    })),
    ...saved.map((row) => toResolved(row, clerkUserId)),
  ];
}

function toResolved(row: CrmSavedView, clerkUserId: string): ResolvedView {
  return {
    id: row.id,
    name: row.name,
    isBuiltIn: false,
    isShared: row.isShared,
    isMine: row.ownerClerkUserId === clerkUserId,
    // Re-validated on every read, never trusted from storage: a view saved when
    // a field existed must not become a page that cannot load once it is gone.
    conditions: parseFilter(row.filter),
    sort: parseSort(row.sort),
  };
}

/**
 * The view to show, given an id that may name anything or nothing.
 *
 * FALLS BACK RATHER THAN FAILING, which is what makes `crm_view_pins.view_id`
 * safe to store without a foreign key. A pin can name a view that was deleted,
 * one that was shared and then made private, or a built-in a later release
 * retired — all three resolve to the default instead of a broken page.
 */
export async function resolveView(
  tx: Tx,
  tenantId: string,
  clerkUserId: string,
  viewId: string | null,
  entityType = "party",
): Promise<ResolvedView> {
  const fallback = (): ResolvedView => {
    const all = builtInView("builtin:all")!;
    return {
      id: all.id,
      name: all.name,
      isBuiltIn: true,
      isShared: true,
      isMine: false,
      conditions: resolveBuiltIn(all, clerkUserId),
      sort: all.sort,
    };
  };

  if (!viewId) return fallback();

  const built = builtInView(viewId);
  if (built) {
    return {
      id: built.id,
      name: built.name,
      isBuiltIn: true,
      isShared: true,
      isMine: false,
      conditions: resolveBuiltIn(built, clerkUserId),
      sort: built.sort,
    };
  }

  // Not a uuid, so it cannot be a saved view and asking would be an error
  // rather than a miss.
  if (!/^[0-9a-f-]{36}$/i.test(viewId)) return fallback();

  const row = await tx.query.crmSavedViews.findFirst({
    where: and(
      eq(schema.crmSavedViews.tenantId, tenantId),
      eq(schema.crmSavedViews.id, viewId),
      eq(schema.crmSavedViews.entityType, entityType),
    ),
  });
  return row ? toResolved(row, clerkUserId) : fallback();
}

export const VIEW_NAME_MAX = 60;

export async function createView(
  tx: Tx,
  tenantId: string,
  clerkUserId: string,
  input: {
    name: string;
    conditions: FilterCondition[];
    sort: ViewSort;
    isShared: boolean;
    entityType?: string;
  },
): Promise<CrmSavedView> {
  const name = input.name.trim();
  if (name.length === 0) throw new CrmError("VIEW_NAME_REQUIRED", "name required");
  if (name.length > VIEW_NAME_MAX) {
    throw new CrmError("VIEW_NAME_REQUIRED", "name too long");
  }

  const rows = await tx
    .insert(schema.crmSavedViews)
    .values({
      tenantId,
      entityType: input.entityType ?? "party",
      name,
      ownerClerkUserId: clerkUserId,
      isShared: input.isShared,
      filter: input.conditions,
      sort: input.sort,
    })
    .onConflictDoNothing()
    .returning();

  const row = rows[0];
  if (!row) throw new CrmError("VIEW_NAME_TAKEN", "you already have a view with that name");
  return row;
}

export async function updateView(
  tx: Tx,
  tenantId: string,
  viewId: string,
  patch: {
    name?: string;
    conditions?: FilterCondition[];
    sort?: ViewSort;
    isShared?: boolean;
  },
): Promise<void> {
  const rows = await tx
    .update(schema.crmSavedViews)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.conditions !== undefined ? { filter: patch.conditions } : {}),
      ...(patch.sort !== undefined ? { sort: patch.sort } : {}),
      ...(patch.isShared !== undefined ? { isShared: patch.isShared } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.crmSavedViews.tenantId, tenantId),
        eq(schema.crmSavedViews.id, viewId),
      ),
    )
    .returning({ id: schema.crmSavedViews.id });
  // Zero rows means RLS refused it — somebody else's view. The message says
  // what is true rather than "not found", because the view plainly exists in
  // the picker they clicked it from.
  if (rows.length === 0) {
    throw new CrmError("VIEW_NOT_YOURS", "only the person who made a view can change it");
  }
}

export async function deleteView(
  tx: Tx,
  tenantId: string,
  viewId: string,
): Promise<void> {
  const rows = await tx
    .delete(schema.crmSavedViews)
    .where(
      and(
        eq(schema.crmSavedViews.tenantId, tenantId),
        eq(schema.crmSavedViews.id, viewId),
      ),
    )
    .returning({ id: schema.crmSavedViews.id });
  if (rows.length === 0) {
    throw new CrmError("VIEW_NOT_YOURS", "only the person who made a view, or an owner, can delete it");
  }
  // Pins naming it are left alone deliberately: `resolveView` falls back, and a
  // cleanup pass here would need to reach across other people's pin rows, which
  // the pin policy correctly refuses.
}

/* -- Pins ----------------------------------------------------------------- */

export async function pinnedViewId(
  tx: Tx,
  tenantId: string,
  clerkUserId: string,
  entityType = "party",
): Promise<string | null> {
  const row = await tx.query.crmViewPins.findFirst({
    where: and(
      eq(schema.crmViewPins.tenantId, tenantId),
      eq(schema.crmViewPins.clerkUserId, clerkUserId),
      eq(schema.crmViewPins.entityType, entityType),
    ),
  });
  return row?.viewId ?? null;
}

export async function pinView(
  tx: Tx,
  tenantId: string,
  clerkUserId: string,
  viewId: string,
  entityType = "party",
): Promise<void> {
  await tx
    .insert(schema.crmViewPins)
    .values({ tenantId, clerkUserId, entityType, viewId })
    .onConflictDoUpdate({
      target: [
        schema.crmViewPins.tenantId,
        schema.crmViewPins.clerkUserId,
        schema.crmViewPins.entityType,
      ],
      set: { viewId, updatedAt: new Date() },
    });
}
