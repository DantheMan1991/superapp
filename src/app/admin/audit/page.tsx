import { desc, eq } from "drizzle-orm";
import { withSystem, schema } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { describeMeta } from "@/lib/audit-detail";
import { DataTable } from "@/components/app/data-table";
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
      <PageHeader
        title="Audit log"
        description="Sensitive actions across the platform — admin access, module changes, billing events."
      />

      <div>
        <h2 className="font-heading font-medium tracking-heading">
          Latest {rows.length} events
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Append-only. Identifiers, never secrets — what changed is shown under
          each action, and a correction shows what it moved from and to.
        </p>
        <DataTable stickyHeader>
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
                    {/* WHAT ACTUALLY CHANGED, under the action rather than in a
                        column of its own: the detail belongs to the verb, and a
                        sixth column would squash the four that identify the
                        row. A correction reads "meat withdrawal days: 21 → 28"
                        on one line. */}
                    {describeMeta(entry.meta).map((detail, i) => (
                      <div
                        key={`${entry.id}-${i}`}
                        className="mt-0.5 text-xs text-muted-foreground"
                      >
                        <span>{detail.label}:</span>{" "}
                        <span
                          className={
                            detail.changed ? "text-foreground" : undefined
                          }
                        >
                          {detail.value}
                        </span>
                      </div>
                    ))}
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
        </DataTable>
      </div>
    </div>
  );
}
