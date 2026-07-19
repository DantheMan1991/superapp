import { desc, eq } from "drizzle-orm";
import { withSystem, schema } from "@/db";
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

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const rows = await withSystem((tx) =>
    tx
      .select({
        entry: schema.auditLog,
        tenantName: schema.tenants.name,
      })
      .from(schema.auditLog)
      .leftJoin(
        schema.tenants,
        eq(schema.auditLog.tenantId, schema.tenants.id),
      )
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(200),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Sensitive actions across the platform — admin access, module changes,
          billing events.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Latest {rows.length} events</CardTitle>
          <CardDescription>Append-only. Identifiers, never secrets.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Nothing logged yet.
                  </TableCell>
                </TableRow>
              )}
              {rows.map(({ entry, tenantName }) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {entry.createdAt.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{entry.action}</code>
                  </TableCell>
                  <TableCell>{tenantName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.actorLabel ?? entry.actorClerkUserId ?? "system"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.targetType
                      ? `${entry.targetType}:${entry.targetId ?? ""}`
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
