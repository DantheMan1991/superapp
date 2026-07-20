import Link from "next/link";
import { desc } from "drizzle-orm";
import { Plus } from "lucide-react";
import { withSystem, schema } from "@/db";
import type { AuditMessage } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-accent text-accent-foreground",
  report_ready: "bg-success/15 text-emerald-700 dark:text-emerald-300",
  won: "bg-success/15 text-emerald-700 dark:text-emerald-300",
  lost: "bg-muted text-muted-foreground",
};

export default async function AuditsPage() {
  const audits = await withSystem((tx) =>
    tx.query.audits.findMany({ orderBy: desc(schema.audits.updatedAt) }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Discovery</h1>
          <p className="text-sm text-muted-foreground">
            Tier 0 audits — learn a prospect&apos;s business with an AI
            copilot, then generate the health check and build spec.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/audits/new">
            <Plus className="size-4" /> New audit
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {audits.length} engagement{audits.length === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>
            The audit is the sales wedge — it reveals the work.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Exchanges</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audits.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No discovery engagements yet. Start one before your next
                    prospect call.
                  </TableCell>
                </TableRow>
              )}
              {audits.map((audit) => {
                const exchanges = Math.floor(
                  ((audit.messages as AuditMessage[])?.length ?? 0) / 2,
                );
                return (
                  <TableRow key={audit.id}>
                    <TableCell>
                      <Link
                        href={`/admin/audits/${audit.id}`}
                        className="font-medium hover:underline"
                      >
                        {audit.businessName}
                      </Link>
                      {audit.contactName && (
                        <div className="text-xs text-muted-foreground">
                          {audit.contactName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {audit.industry}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "border-transparent",
                          STATUS_STYLES[audit.status],
                        )}
                      >
                        {audit.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {exchanges}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {audit.updatedAt.toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
