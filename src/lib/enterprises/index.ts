import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Enterprise } from "@/db/schema";
import {
  archiveDimensionMember,
  listDimensionMembers,
  upsertDimensionMember,
} from "@/modules/accounting/core";
import type { LedgerCtx } from "@/modules/accounting/core";
import { EnterpriseError } from "./errors";
import { slugify, uniqueSlug } from "./slug";

/**
 * THE ENTERPRISE SUBSYSTEM — the single door onto `enterprises`.
 *
 * At `src/lib/` for the reason the party spine is: **four packs name an
 * enterprise and none of them owns it.** `inventory` tags an item, `livestock`
 * a pen, `production` a run, `retail` a channel. A table living in any one of
 * those makes the other three depend on a pack they do not require. See the
 * schema file's header, and eslint.config.mjs for the general rule.
 *
 * The three properties `src/lib/parties/` documents hold here unchanged, and
 * they are correctness rather than style:
 *
 *  1. **Every function takes the CALLER'S `tx`.** Nothing here opens a
 *     transaction, calls `withTenant`, or calls `withSystem`. The caller has
 *     already established the RLS context from a `requireTenant()` result, so
 *     what this can read and write is exactly what the person asking may.
 *  2. **`tenantId` is passed explicitly and is in every WHERE clause**, so the
 *     query is right even if the RLS context were somehow wrong.
 *  3. **One writer.** Two call sites issuing their own UPDATEs against one
 *     table is how a codebase acquires last-write-wins bugs nobody can
 *     reproduce.
 *
 * ── THE DIMENSION SYNC IS THE POINT OF THIS FILE ─────────────────────────────
 *
 * **Every write here mirrors into `dimension_members` in the SAME transaction**,
 * exactly as `land` does for a parcel and `assets` for an asset. That mirror is
 * what makes an enterprise a reportable thing at all: the P&L's dimension picker
 * is built from whatever types exist in that table, so `enterprise` appears
 * there the moment the first row is created, and no report code was written to
 * make it happen.
 *
 * **The display name in `dimension_members` is a COPY**, so a rename that
 * skipped the re-sync would leave every report labelling the business by its
 * old name. `updateEnterprise` re-syncs on any name change, and `land` learned
 * that the same way.
 */

export type { Enterprise };
export { EnterpriseError } from "./errors";
export { SLUG_FORMAT, slugify, uniqueSlug } from "./slug";

/** The dimension type every enterprise mirrors under. */
export const ENTERPRISE_DIMENSION = "enterprise";

/** Suggestions, not a taxonomy. The column takes any slug. */
export const SUGGESTED_ENTERPRISE_KINDS = ["livestock", "crop", "other"] as const;

const KIND_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

export interface EnterpriseInput {
  name: string;
  kind?: string;
  notes?: string;
}

export async function listEnterprises(
  tx: Tx,
  tenantId: string,
  filter: { status?: string } = {},
): Promise<Enterprise[]> {
  const where = [eq(schema.enterprises.tenantId, tenantId)];
  if (filter.status) where.push(eq(schema.enterprises.status, filter.status));
  return tx.query.enterprises.findMany({
    where: and(...where),
    orderBy: (e) => [asc(e.name)],
  });
}

export async function getEnterprise(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<Enterprise | null> {
  const row = await tx.query.enterprises.findFirst({
    where: and(
      eq(schema.enterprises.tenantId, tenantId),
      eq(schema.enterprises.id, id),
    ),
  });
  return row ?? null;
}

/**
 * The `dimension_members` row id for each enterprise, keyed by enterprise id.
 *
 * **THE TRANSLATION EVERY POSTING PATH WILL NEED**, and the reason it is here
 * rather than in each pack: a journal line is tagged with a MEMBER id, not with
 * an enterprise id, and a pack that looked that up itself would be reaching
 * into core's tables — which is the boundary this whole arrangement exists to
 * keep.
 *
 * One query whatever the count, because the callers are lists.
 */
export async function enterpriseMemberIds(
  tx: Tx,
  tenantId: string,
): Promise<Map<string, string>> {
  const members = await listDimensionMembers(tx, tenantId, ENTERPRISE_DIMENSION);
  return new Map(members.map((m) => [m.packEntityId, m.id]));
}

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    throw new EnterpriseError("INVALID_NAME", "an enterprise needs a name");
  }
  if (trimmed.length > 120) {
    throw new EnterpriseError("INVALID_NAME", "that name is too long");
  }
  return trimmed;
}

function cleanKind(kind: string | undefined): string {
  const value = (kind ?? "other").trim().toLowerCase().replace(/\s+/g, "_");
  if (!KIND_FORMAT.test(value)) {
    throw new EnterpriseError("INVALID_KIND", `invalid kind: ${kind}`);
  }
  return value;
}

/**
 * **NAME UNIQUENESS IS CHECKED IN CODE AND NOT IN THE DATABASE, deliberately.**
 * The unique index is on the SLUG, which is the machine's handle and must never
 * collide. Two enterprises a person has named the same thing is a different
 * problem: it makes their own list unreadable, and the honest response is a
 * sentence rather than a constraint violation. Case-insensitive, because
 * "Broilers" and "broilers" are the same line of business to everybody except a
 * byte comparison.
 */
async function assertNameFree(
  tx: Tx,
  tenantId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const existing = await listEnterprises(tx, tenantId);
  const clash = existing.find(
    (e) => e.id !== exceptId && e.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) {
    // **THE EXISTING NAME, NOT THE TYPED ONE.** Somebody typing "broilers"
    // against a list holding "Broilers" is told "there is already a Broilers",
    // which points at the row they meant; echoing their own lowercase back
    // reads as the app quibbling about capitals.
    throw new EnterpriseError("NAME_TAKEN", `there is already a ${clash.name}`);
  }
}

export async function createEnterprise(
  tx: Tx,
  ctx: LedgerCtx,
  input: EnterpriseInput,
): Promise<Enterprise> {
  const name = cleanName(input.name);
  const kind = cleanKind(input.kind);
  await assertNameFree(tx, ctx.tenantId, name);

  const base = slugify(name);
  if (!base) {
    throw new EnterpriseError(
      "INVALID_NAME",
      "that name has no letters or numbers in it to make a handle from",
    );
  }
  const existing = await listEnterprises(tx, ctx.tenantId);
  const slug = uniqueSlug(base, existing.map((e) => e.slug));

  const rows = await tx
    .insert(schema.enterprises)
    .values({
      tenantId: ctx.tenantId,
      name,
      slug,
      kind,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  const enterprise = rows[0];

  // SAME TRANSACTION, ALWAYS. See the file header — and note this is what
  // enforces owner-only, because `upsertDimensionMember` calls
  // `requireOwnerRole` and this is the only path that creates the row.
  await upsertDimensionMember(tx, ctx, {
    dimensionType: ENTERPRISE_DIMENSION,
    packEntityId: enterprise.id,
    displayName: enterprise.name,
  });

  return enterprise;
}

export async function updateEnterprise(
  tx: Tx,
  ctx: LedgerCtx,
  id: string,
  input: Partial<EnterpriseInput>,
): Promise<Enterprise> {
  const existing = await getEnterprise(tx, ctx.tenantId, id);
  if (!existing) {
    throw new EnterpriseError("NOT_FOUND", `enterprise ${id} not found`);
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  let renamed = false;
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (name !== existing.name) {
      await assertNameFree(tx, ctx.tenantId, name, id);
      patch.name = name;
      renamed = true;
    }
  }
  if (input.kind !== undefined) patch.kind = cleanKind(input.kind);
  if (input.notes !== undefined) patch.notes = input.notes.trim();

  const rows = await tx
    .update(schema.enterprises)
    .set(patch)
    .where(
      and(
        eq(schema.enterprises.tenantId, ctx.tenantId),
        eq(schema.enterprises.id, id),
      ),
    )
    .returning();
  const enterprise = rows[0];

  /**
   * **THE SLUG DOES NOT MOVE, AND THE MEMBER'S NAME DOES.** The handle is what
   * anything holding a reference kept; the display name is a copy that every
   * report reads, so a rename that skipped this would label a business by a
   * name it no longer uses.
   */
  if (renamed) {
    await upsertDimensionMember(tx, ctx, {
      dimensionType: ENTERPRISE_DIMENSION,
      packEntityId: enterprise.id,
      displayName: enterprise.name,
    });
  }
  return enterprise;
}

/**
 * Retire an enterprise. **The member is archived, never deleted.**
 *
 * `archiveDimensionMember`'s own comment says why: *"archived members stop
 * being taggable; existing tags keep reporting."* A business that ran pigs for
 * two years and stopped still has two years of pig costs, and a report over
 * last year has to keep showing them.
 */
export async function archiveEnterprise(
  tx: Tx,
  ctx: LedgerCtx,
  id: string,
): Promise<Enterprise> {
  return setStatus(tx, ctx, id, "archived");
}

/** Put one back. Retiring is a judgement, and judgements are wrong sometimes. */
export async function restoreEnterprise(
  tx: Tx,
  ctx: LedgerCtx,
  id: string,
): Promise<Enterprise> {
  return setStatus(tx, ctx, id, "active");
}

async function setStatus(
  tx: Tx,
  ctx: LedgerCtx,
  id: string,
  status: "active" | "archived",
): Promise<Enterprise> {
  const existing = await getEnterprise(tx, ctx.tenantId, id);
  if (!existing) {
    throw new EnterpriseError("NOT_FOUND", `enterprise ${id} not found`);
  }
  const rows = await tx
    .update(schema.enterprises)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(schema.enterprises.tenantId, ctx.tenantId),
        eq(schema.enterprises.id, id),
      ),
    )
    .returning();

  const members = await listDimensionMembers(
    tx,
    ctx.tenantId,
    ENTERPRISE_DIMENSION,
  );
  const member = members.find((m) => m.packEntityId === id);
  if (member) {
    if (status === "archived") {
      await archiveDimensionMember(tx, ctx, { memberId: member.id });
    } else {
      // `upsertDimensionMember` sets `is_active: true` on conflict, which is
      // the un-archive. One function, both directions, no second SQL path.
      await upsertDimensionMember(tx, ctx, {
        dimensionType: ENTERPRISE_DIMENSION,
        packEntityId: id,
        displayName: rows[0].name,
      });
    }
  }
  return rows[0];
}
