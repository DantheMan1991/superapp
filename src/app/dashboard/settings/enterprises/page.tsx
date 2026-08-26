import Link from "next/link";
import { ChevronLeft, Sprout } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { listEnterprises } from "@/lib/enterprises";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EnterpriseControls,
  EnterpriseForm,
} from "./enterprise-controls";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  livestock: "Livestock",
  crop: "Crop",
  other: "Other",
};

/**
 * **THE ENTERPRISE LIST — the lines of business this farm wants the money for
 * separately.**
 *
 * In Settings rather than in a module, because four packs name an enterprise
 * and none of them owns it (see `src/db/schema/enterprises.ts`). Putting it
 * under Inventory would hide it from a farm running only Livestock, and would
 * make it look like an inventory idea rather than the reporting dimension it is.
 *
 * **NOTHING IS TAGGED WITH ONE YET, AND THE PAGE SAYS SO.** This is the first
 * of four slices; the tagging is the next. A screen that let somebody build a
 * list and then quietly did nothing with it would be the "setting that does
 * nothing" this codebase keeps guarding against — so the panel below names what
 * exists today and what does not.
 */
export default async function EnterprisesPage() {
  const ctx = await requireTenantOwner();

  // Archived ones are shown too, at the bottom: the list is short, and the only
  // way to put one back is to be able to see it.
  const enterprises = await withTenant(
    ctx.tenant.id,
    (tx) => listEnterprises(tx, ctx.tenant.id),
    { role: ctx.role },
  );

  const active = enterprises.filter((e) => e.status === "active");
  const retired = enterprises.filter((e) => e.status !== "active");

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/settings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Business settings
      </Link>

      <PageHeader
        title="Enterprises"
        description="The lines of business you want to see the money for on their own."
        actions={<EnterpriseForm />}
      />

      {enterprises.length === 0 ? (
        <EmptyState
          panel
          icon={<Sprout className="h-5 w-5" />}
          title="No enterprises yet"
          description="Broilers, Beef, Pigs, Eggs — whatever you would want a separate profit figure for. Most farms have between three and six, and you can change the list whenever you like."
          action={<EnterpriseForm />}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Enterprise</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...active, ...retired].map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    {e.name}
                    {e.status !== "active" && (
                      <Badge variant="outline">retired</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {KIND_LABELS[e.kind] ?? e.kind}
                </TableCell>
                <TableCell className="max-w-sm truncate text-muted-foreground">
                  {e.notes || "—"}
                </TableCell>
                <TableCell>
                  <EnterpriseControls
                    enterprise={{
                      id: e.id,
                      name: e.name,
                      slug: e.slug,
                      kind: e.kind,
                      status: e.status,
                      notes: e.notes,
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Card>
        <CardContent className="space-y-2 pt-6 text-sm text-muted-foreground">
          {/**
           * **WHAT THIS DOES AND DOES NOT DO YET, said plainly.** Slice 1 of
           * four builds the list and the reporting registration; nothing is
           * tagged with an enterprise until slice 2, and no posted entry
           * carries one until slice 3. A page that implied otherwise would send
           * somebody to a profit report that is entirely Unassigned and let
           * them conclude the feature is broken.
           */}
          <p className="font-medium text-foreground">
            What this list does today
          </p>
          <p>
            Every enterprise here is registered as a reporting dimension, so
            &ldquo;Enterprise&rdquo; now appears in the grouping picker on the
            profit and loss report.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Nothing is tagged with one yet.
            </span>{" "}
            Until items, batches, market channels and processing runs can name an
            enterprise, that report will show every figure under Unassigned. That
            is the next piece of work, not a fault.
          </p>
          <p>
            Retiring an enterprise stops it being offered on new records and
            leaves everything already recorded against it reporting exactly as
            before — last year&rsquo;s figures never move.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
