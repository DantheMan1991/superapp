import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listFieldDefs } from "@/modules/crm/field-ops";
import { FieldManager } from "@/modules/crm/components/field-manager";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

/**
 * Custom field settings.
 *
 * READABLE BY EVERYONE, WRITABLE BY OWNERS — the same split RLS enforces
 * (drizzle/0067). Staff land here and see what the fields ARE, which is useful
 * on its own; the controls are simply absent for them. Hiding the page outright
 * would leave a staff member with no way to find out what "Warranty expiry"
 * means on a record they are filling in.
 */
export default async function FieldsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  const defs = await withTenant(
    ctx.tenant.id,
    (tx) => listFieldDefs(tx, ctx.tenant.id, "party", { includeArchived: true }),
    { role: ctx.role },
  );

  const isOwner = ctx.role === "owner";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        All records
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fields</h1>
        <p className="text-sm text-muted-foreground">
          The things this business tracks that the standard fields do not cover.
        </p>
      </div>

      {isOwner ? (
        <FieldManager defs={defs} />
      ) : (
        <>
          <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
            Only an owner can change these. Everything set up here appears on
            every record.
          </p>
          {defs.filter((d) => !d.archivedAt).length === 0 ? (
            <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
              No custom fields yet.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {defs
                .filter((d) => !d.archivedAt)
                .map((def) => (
                  <li key={def.id} className="px-4 py-3">
                    <p className="text-sm font-medium">{def.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {def.helpText || def.key}
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
