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
 * **THE PANEL AT THE BOTTOM NAMES WHAT EXISTS AND WHAT DOES NOT, and it is not
 * padding.** A screen that let somebody build a list and then quietly did
 * nothing with it would be the "setting that does nothing" this codebase keeps
 * guarding against.
 *
 * **IT IS ALSO THE FIRST THING A SLICE FORGETS.** It still said "Nothing is
 * tagged with one yet" for four days after slice 2 made items, batches,
 * channels and runs all taggable, telling people the feature was unbuilt while
 * they were using it. Anything that changes what an enterprise reaches changes
 * this paragraph in the same PR.
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
           * **WHAT THIS DOES AND DOES NOT DO YET, said plainly.** The panel
           * exists because a screen that let somebody build a list and then
           * quietly did nothing with it is the "setting that does nothing" this
           * codebase keeps guarding against.
           *
           * **IT HAS TO BE REWRITTEN EVERY TIME A SLICE LANDS, and slice 2
           * proved that by not being.** It still read "Nothing is tagged with
           * one yet" a week after items, batches, channels and runs could all
           * name one — so the page was telling people the feature was unbuilt
           * while they were using it. Slice 3 rewrote it for the ledger and for
           * the two things that are still true and awkward: **the costs are in
           * and the income is not, and there is no back-fill.**
           */}
          <p className="font-medium text-foreground">
            What this list does today
          </p>
          <p>
            Everything here is registered as a reporting dimension, so
            &ldquo;{word}&rdquo; appears in the grouping picker on the profit and
            loss report. Items and batches can name one, and a batch inherits its
            item&rsquo;s.
          </p>
          <p>
            <span className="font-medium text-foreground">
              What things cost now lands against them.
            </span>{" "}
            {/* NO NOUN FOR A PRODUCTION RUN HERE. The farm profile calls one a
                "Batch", another profile will call it something else, and this
                is a Layer 0 screen with no access to that pack's labels — so
                the sentence describes what happens without naming the record. */}
            Feed issued to a batch is charged to whatever that batch belongs to,
            stock sold takes its cost from the batch it came out of, and a fee
            for processing follows the batches that went in.{" "}
            <span className="font-medium text-foreground">
              What you sell does not yet.
            </span>{" "}
            So the report answers what a line of business has cost you, not what
            it has made you. That is the next piece of work, not a fault.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Nothing before today can be counted, and it never will be.
            </span>{" "}
            Entries already in the books were posted without any of this and
            cannot be given one without rewriting history, so a report over last
            year will read Unassigned however much you tag now. Today is the day
            the figures start being true.
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
