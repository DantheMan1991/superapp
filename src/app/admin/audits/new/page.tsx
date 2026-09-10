import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withTenant, schema } from "@/db";
import { getOperatorTenant } from "@/lib/operator-tenant";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NewAuditForm } from "./new-audit-form";

export const dynamic = "force-dynamic";

export default async function NewAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ party?: string }>;
}) {
  const { party: preselectedId } = await searchParams;

  // The businesses a discovery can be about: the operator's organization
  // parties (ADR 0041, slice 2), read through its own context as staff.
  const operator = await getOperatorTenant();
  const businesses = operator
    ? await withTenant(
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
      )
    : [];

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href="/admin/audits"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to discovery
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>New discovery engagement</CardTitle>
          <CardDescription>
            Pick the business from the operator&apos;s CRM. The copilot starts
            from its name and whatever you type below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewAuditForm
            businesses={businesses}
            preselectedId={preselectedId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
