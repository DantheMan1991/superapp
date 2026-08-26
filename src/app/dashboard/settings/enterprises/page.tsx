import Link from "next/link";
import { ChevronLeft, Sprout } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { listEnterprises } from "@/lib/enterprises";
import {
  ENTERPRISE_FALLBACK,
  ENTERPRISE_FALLBACK_PLURAL,
  ENTERPRISE_LABEL_KEY,
  enterpriseKindsFrom,
  slugLabel,
} from "@/lib/enterprises/vocabulary";
import { packContext } from "@/lib/packs/tenant-context";
import { labelFor } from "@/lib/packs/resolve";
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

/**
 * **THE LIST OF LINES OF BUSINESS a tenant wants the money for separately.**
 *
 * In Settings rather than in a module, because four packs name one and none of
 * them owns it (see `src/db/schema/enterprises.ts`). Putting it under Inventory
 * would hide it from a business running only Livestock, and would make it look
 * like an inventory idea rather than the reporting dimension it is.
 *
 * **EVERY NOUN ON THIS PAGE COMES FROM THE PROFILE.** The first version said
 * "Enterprises", offered "Livestock" and "Crop", and told the reader that *"most
 * farms have between three and six"* — a Layer 0 screen telling a law firm what
 * its lines of business are made of. The word and the kinds are resolved now;
 * the farm profile supplies "Enterprise", "livestock" and "crop", and a profile
 * that supplies nothing gets the neutral word and a free-text field.
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
  const { enterprises, pack } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      enterprises: await listEnterprises(tx, ctx.tenant.id),
      // `enterprises` is not a pack; the key is a namespace for the profile's
      // defaults. See the profile's own comment on it.
      pack: await packContext(
        tx,
        ctx.tenant.id,
        ctx.tenant.industry,
        "enterprises",
      ),
    }),
    { role: ctx.role },
  );

  const word = labelFor(pack.labels, ENTERPRISE_LABEL_KEY, ENTERPRISE_FALLBACK);
  const plural =
    word === ENTERPRISE_FALLBACK ? ENTERPRISE_FALLBACK_PLURAL : `${word}s`;
  const kinds = enterpriseKindsFrom(pack.config);

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
        title={plural}
        description={`The parts of the business you want to see the money for on their own.`}
        actions={<EnterpriseForm word={word} kinds={kinds} />}
      />

      {enterprises.length === 0 ? (
        <EmptyState
          panel
          icon={<Sprout className="h-5 w-5" />}
          title={`No ${plural.toLowerCase()} yet`}
          /* NO EXAMPLES, because an example is an industry. "Whatever you would
             want a separate profit figure for" is the definition and works for a
             farm, a law firm and a bakery alike. */
          description={`Whatever you would want a separate profit figure for. Most businesses have between three and six, and you can change the list whenever you like.`}
          action={<EnterpriseForm word={word} kinds={kinds} />}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{word}</TableHead>
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
                  {/* The stored slug, prettied. No lookup table, because a
                      lookup table is a list of kinds and this file must not
                      hold one. */}
                  {slugLabel(e.kind)}
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
                    word={word}
                    kinds={kinds}
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
            Everything here is registered as a reporting dimension, so
            &ldquo;{word}&rdquo; now appears in the grouping picker on the profit
            and loss report.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Nothing is tagged with one yet.
            </span>{" "}
            Until items, batches, sales channels and production runs can name
            one, that report will show every figure under Unassigned. That is the
            next piece of work, not a fault.
          </p>
          <p>
            Retiring one stops it being offered on new records and leaves
            everything already recorded against it reporting exactly as before —
            last year&rsquo;s figures never move.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
