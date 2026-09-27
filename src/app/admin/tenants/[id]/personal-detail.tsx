import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withSystem, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TenantStatusBadge } from "@/components/status-badge";

/**
 * A PERSONAL SPACE, as the console sees it (ADR 0111): whose it is, when it
 * was made, and which tools are on. Nothing else.
 *
 * Deliberately not the business page with buttons hidden. That page is built
 * around a client — the relationship, the retainer, billing, the industry, the
 * vocabulary, support view — and a personal space has none of them; every one
 * of their actions refuses a personal space as well (`personal-space-core.ts`).
 *
 * **No activity log.** The business page shows the tenant's recent audit rows.
 * Here those rows would be the person's own activity inside their private
 * space, which is exactly what support view was refused so as not to show.
 */
export async function PersonalTenantDetail({ tenantId }: { tenantId: string }) {
  const data = await withSystem(async (tx) => {
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
    });
    if (!tenant || tenant.kind !== "personal") return null;
    const owner = tenant.personalOwnerClerkUserId
      ? await tx.query.profiles.findFirst({
          where: eq(schema.profiles.clerkUserId, tenant.personalOwnerClerkUserId),
          columns: { name: true, email: true },
        })
      : undefined;
    const tools = await tx
      .select({
        id: schema.modules.id,
        name: schema.modules.name,
        enabled: schema.tenantModules.enabled,
      })
      .from(schema.tenantModules)
      .innerJoin(schema.modules, eq(schema.modules.id, schema.tenantModules.moduleId))
      .where(eq(schema.tenantModules.tenantId, tenant.id))
      .orderBy(asc(schema.modules.sortOrder));
    return { tenant, owner: owner ?? null, tools };
  });
  if (!data) notFound();
  const { tenant, owner, tools } = data;

  return (
    <div className="space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All clients
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-heading">
          {owner?.name ?? owner?.email ?? "Personal space"}
        </h1>
        <Badge variant="outline">Personal space</Badge>
        <TenantStatusBadge status={tenant.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Somebody&apos;s own space</CardTitle>
          <CardDescription>
            Not a client. The console does not open it and has nothing to do
            to it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Support view never opens a personal space (ADR 0111). There is no
            relationship, retainer, plan, industry or vocabulary for one, and
            its activity is not shown here.
          </p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Owner</dt>
            <dd>{owner ? owner.email : "No profile yet"}</dd>
            <dt className="text-muted-foreground">Made</dt>
            <dd>{tenant.createdAt.toLocaleDateString()}</dd>
            <dt className="text-muted-foreground">Clock</dt>
            <dd>{tenant.timezone}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tools</CardTitle>
          <CardDescription>
            Every available personal tool is switched on when a space is made,
            and in every space when a new one ships.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {tools.length === 0 ? (
            <p className="text-muted-foreground">None yet.</p>
          ) : (
            <ul className="space-y-1">
              {tools.map((tool) => (
                <li key={tool.id} className="flex items-center gap-2">
                  {tool.name}
                  {!tool.enabled && <Badge variant="outline">Off</Badge>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
