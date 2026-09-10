import Link from "next/link";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withSystem, withTenant, schema } from "@/db";
import { listIndustryProfiles } from "@/industries";
import { getOperatorTenant } from "@/lib/operator-tenant";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NewWorkspaceForm } from "./new-client-form";

export const dynamic = "force-dynamic";

export default async function NewWorkspacePage() {
  // The businesses a workspace can be made for: the operator's organization
  // parties that no workspace points at yet (ADR 0041, slice 3), read through
  // the operator's own context as staff.
  const operator = await getOperatorTenant();
  const [parties, taken] = operator
    ? await Promise.all([
        withTenant(
          operator.id,
          (tx) =>
            tx
              .select({ id: schema.parties.id, name: schema.parties.displayName })
              .from(schema.parties)
              .where(
                and(
                  eq(schema.parties.tenantId, operator.id),
                  eq(schema.parties.kind, "organization"),
                  eq(schema.parties.isActive, true),
                ),
              )
              .orderBy(asc(schema.parties.displayName)),
          { role: "staff" },
        ),
        withSystem((tx) =>
          tx
            .select({ partyId: schema.tenants.operatorPartyId })
            .from(schema.tenants)
            .where(isNotNull(schema.tenants.operatorPartyId)),
        ),
      ])
    : [[], []];
  const takenIds = new Set(taken.map((t) => t.partyId));
  const available = parties.filter((p) => !takenIds.has(p.id));
  const profiles = listIndustryProfiles().map((p) => ({
    slug: p.slug,
    name: p.name,
    description: p.description,
  }));

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to clients
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>New workspace</CardTitle>
          <CardDescription>
            A workspace is made for a business that already exists as a party
            in the operator&apos;s CRM — its people, deals and notes stay
            there. This creates the login workspace, points it at the party,
            and optionally installs a profile and invites the owner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {operator ? (
            <NewWorkspaceForm parties={available} profiles={profiles} />
          ) : (
            <p className="text-sm text-muted-foreground">
              No operator tenant is named yet — run scripts/operator-tenant.ts
              first.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
