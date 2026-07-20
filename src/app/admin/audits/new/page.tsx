import Link from "next/link";
import { asc } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withSystem, schema } from "@/db";
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
  searchParams: Promise<{ tenant?: string }>;
}) {
  const { tenant: preselectedId } = await searchParams;

  const businesses = await withSystem((tx) =>
    tx.query.tenants.findMany({
      columns: { id: true, name: true, industry: true, status: true },
      orderBy: asc(schema.tenants.name),
    }),
  );

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
            Pick the business from your CRM — prospects and clients both work.
            The copilot gets everything the CRM knows about them.
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
