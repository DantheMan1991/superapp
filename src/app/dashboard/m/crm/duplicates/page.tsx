import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { and, eq, inArray } from "drizzle-orm";
import { withTenant, schema } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { findMergeCandidates } from "@/modules/crm/merge-ops";
import { DuplicateList } from "@/modules/crm/components/duplicate-list";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

/**
 * Duplicates, and the merge tool.
 *
 * OWNER-ONLY IN FULL, unlike the fields page next door — and the difference is
 * worth stating because the two look like the same kind of settings screen.
 * Fields are readable by everyone because knowing what "Warranty expiry" means
 * helps a staff member fill a record in. This page is a list of one job, and
 * that job deletes an identity and moves posted invoices. Showing it to
 * somebody who cannot finish it would be a page of buttons that refuse.
 *
 * THE LIST PROPOSES AND NEVER ACTS. Nothing here merges anything on its own,
 * and the ordering is evidence-weighted rather than confidence-scored: a shared
 * address outranks a shared name because an address is evidence about a
 * business and a name is evidence about a string.
 */
export default async function DuplicatesPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  if (ctx.role !== "owner") {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <BackLink />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Duplicates</h1>
        </div>
        <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
          Only an owner can merge records. Merging moves invoices and bills onto
          one customer and cannot be undone, so it is kept to the people who own
          the books.
        </p>
      </div>
    );
  }

  const { candidates, names } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const found = await findMergeCandidates(tx, ctx.tenant.id);
      const ids = [...new Set(found.flatMap((c) => [c.aPartyId, c.bPartyId]))];
      const rows =
        ids.length === 0
          ? []
          : await tx
              .select({
                id: schema.parties.id,
                displayName: schema.parties.displayName,
                kind: schema.parties.kind,
              })
              .from(schema.parties)
              .where(
                and(
                  eq(schema.parties.tenantId, ctx.tenant.id),
                  inArray(schema.parties.id, ids),
                ),
              );
      return {
        candidates: found,
        names: Object.fromEntries(
          rows.map((r) => [r.id, { name: r.displayName, kind: r.kind }]),
        ),
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <BackLink />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Duplicates</h1>
        <p className="text-sm text-muted-foreground">
          Records that look like the same business or person. Nothing is merged
          until you choose which one to keep.
        </p>
      </div>

      <DuplicateList candidates={candidates} names={names} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href={BASE}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      All records
    </Link>
  );
}
