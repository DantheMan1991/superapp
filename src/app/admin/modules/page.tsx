import { asc, sql as dsql } from "drizzle-orm";
import { withSystem, schema } from "@/db";
import { moduleRegistry } from "@/modules";
import { Badge } from "@/components/ui/badge";
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

export default async function AdminModulesPage() {
  const rows = await withSystem((tx) =>
    tx
      .select({
        module: schema.modules,
        activeCount: dsql<number>`(
          select count(*)::int from tenant_modules tm
          where tm.module_id = modules.id and tm.enabled = true
        )`,
      })
      .from(schema.modules)
      .orderBy(asc(schema.modules.sortOrder)),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Module registry
        </h1>
        <p className="text-sm text-muted-foreground">
          What the platform can sell. &ldquo;Coming soon&rdquo; entries are
          designed seams — they get built when a paying client pulls them in.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {rows.length} registered
          </CardTitle>
          <CardDescription>
            Implemented = has a renderer in the codebase. Registered = sellable
            slot in the catalog.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Module</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Implemented</TableHead>
                <TableHead className="text-right">Active tenants</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ module: mod, activeCount }) => (
                <TableRow key={mod.id}>
                  <TableCell>
                    <div className="font-medium">{mod.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {mod.description}
                    </div>
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">
                    {mod.category}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        mod.status === "available" ? "default" : "outline"
                      }
                    >
                      {mod.status === "available" ? "available" : "coming soon"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {moduleRegistry[mod.id] ? (
                      <Badge variant="secondary">yes</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        empty slot
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {activeCount}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Registry is empty — run <code>npm run db:seed</code>.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
