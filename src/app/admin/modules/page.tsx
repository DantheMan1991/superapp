import Link from "next/link";
import { asc, isNotNull, sql as dsql } from "drizzle-orm";
import { BookOpen } from "lucide-react";
import { withSystem, schema } from "@/db";
import { isRenderable } from "@/lib/features";
import { listModuleDocs } from "@/lib/build-docs";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
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
  const [rows, clients, tenantModules, docs] = await Promise.all([
    withSystem((tx) =>
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
    ),
    // Matrix rows: tenants with a real workspace (prospects have no org).
    withSystem((tx) =>
      tx
        .select({
          id: schema.tenants.id,
          name: schema.tenants.name,
          status: schema.tenants.status,
        })
        .from(schema.tenants)
        .where(isNotNull(schema.tenants.clerkOrgId))
        .orderBy(asc(schema.tenants.name)),
    ),
    withSystem((tx) => tx.select().from(schema.tenantModules)),
    listModuleDocs(),
  ]);

  // Dossier filename is the module id; the URL now carries its section.
  const docHref = new Map(docs.map((d) => [d.name, `/admin/docs/${d.slug}`]));
  const cell = new Map(
    tenantModules.map((tm) => [`${tm.tenantId}:${tm.moduleId}`, tm]),
  );
  // Matrix columns: only modules something can be enabled for.
  const matrixModules = rows
    .map((r) => r.module)
    .filter((m) => m.status === "available");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Module registry"
        description={
          <>
            What the platform can sell. &ldquo;Coming soon&rdquo; entries are
            designed seams — they get built when a paying client pulls them in.
          </>
        }
      />

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
                    <div className="flex items-center gap-1.5 font-medium">
                      {mod.name}
                      {docHref.has(mod.id) && (
                        <Link
                          href={docHref.get(mod.id)!}
                          className="text-muted-foreground hover:text-foreground"
                          title="Open build docs"
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
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
                    {isRenderable(mod.id) ? (
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Client matrix</CardTitle>
          <CardDescription>
            Who has what. ● enabled (hover for date) · ○ provisioned but
            switched off · — never enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                {matrixModules.map((m) => (
                  <TableHead key={m.id} className="text-center">
                    {m.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link
                      href={`/admin/tenants/${t.id}`}
                      className="font-medium hover:underline"
                    >
                      {t.name}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t.status}
                    </span>
                  </TableCell>
                  {matrixModules.map((m) => {
                    const tm = cell.get(`${t.id}:${m.id}`);
                    return (
                      <TableCell key={m.id} className="text-center">
                        {tm?.enabled ? (
                          <span
                            className="text-green-600 dark:text-green-500"
                            title={
                              tm.enabledAt
                                ? `Enabled ${tm.enabledAt.toISOString().slice(0, 10)}`
                                : "Enabled"
                            }
                          >
                            ●
                          </span>
                        ) : tm ? (
                          <span
                            className="text-muted-foreground"
                            title="Provisioned but disabled"
                          >
                            ○
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {clients.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={matrixModules.length + 1}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No client workspaces yet.
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
