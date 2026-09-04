import { and, asc, eq } from "drizzle-orm";
import { Megaphone } from "lucide-react";
import { schema, withTenant } from "@/db";
import type { BrandKit } from "@/db/schema";
import type { TenantContext } from "@/lib/auth";
import { resolveBrand } from "@/lib/brand/core";
import { loadBrandKits } from "@/lib/brand/read";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { BrandKitPanel } from "./components/brand-kit-panel";
import {
  RemoveCompanyLookButton,
  StartCompanyLookButton,
} from "./components/company-look-controls";

/**
 * The module's only screen, for now: the brand kit.
 *
 * The data is Layer 0 (`brand_kits`, read through `src/lib/brand/`); this is
 * the one place it is EDITED. When the website and domains arrive they get
 * sections of their own and a strip, and the kit moves under `/brand`. Until
 * then a hub with a single tile would be a click that leads nowhere.
 *
 * THE COMPANY WORD IS EARNED, NOT ASSUMED. A one-company business — every
 * client today — sees one kit and never reads the word (ADR 0010). The
 * per-company section appears only when there is a second company to tell
 * apart, or when a company already has a look of its own.
 */
export async function MarketingModule({ ctx }: { ctx: TenantContext }) {
  const { kits, companies } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      kits: await loadBrandKits(tx, ctx.tenant.id),
      companies: await tx.query.entities.findMany({
        where: and(
          eq(schema.entities.tenantId, ctx.tenant.id),
          eq(schema.entities.isActive, true),
        ),
        orderBy: asc(schema.entities.name),
        columns: { id: true, name: true },
      }),
    }),
    { role: ctx.role },
  );

  const business = kits.find((k) => k.entityId === null) ?? null;
  const companyKits = new Map<string, BrandKit>(
    kits.filter((k) => k.entityId !== null).map((k) => [k.entityId as string, k]),
  );
  // Only an owner changes how the business looks; everyone else reads it. The
  // same question the actions' gate asks, so a control never draws enabled for
  // a press that would come back refused.
  const canWrite = ctx.role === "owner";
  const showCompanies = companies.length > 1 || companyKits.size > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        icon={<Megaphone />}
        title="Marketing"
        description={`How ${ctx.tenant.name} looks to its customers. Today that is your brand kit: the logo, colors and tagline on every invoice.`}
      />

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold tracking-heading">
          Your brand
        </h2>
        <BrandKitPanel
          tenantId={ctx.tenant.id}
          entityId={null}
          kit={business}
          resolved={resolveBrand({
            tenantName: ctx.tenant.name,
            business,
            company: null,
          })}
          fallbackName={ctx.tenant.name}
          canWrite={canWrite}
        />
      </section>

      {showCompanies && (
        <section className="space-y-3">
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-heading">
              Companies
            </h2>
            <p className="text-sm text-muted-foreground">
              Each company uses your brand unless you give it a look of its own.
              A company&rsquo;s own look fills in only what you set; anything
              left blank still comes from your brand.
            </p>
          </div>
          {companies.map((company) => {
            const kit = companyKits.get(company.id) ?? null;
            if (!kit) {
              return (
                <Panel
                  key={company.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-5"
                >
                  <div>
                    <div className="font-medium">{company.name}</div>
                    <div className="text-sm text-muted-foreground">
                      Uses your brand.
                    </div>
                  </div>
                  {canWrite && (
                    <StartCompanyLookButton
                      entityId={company.id}
                      name={company.name}
                    />
                  )}
                </Panel>
              );
            }
            return (
              <div key={company.id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-medium">{company.name}</h3>
                  {canWrite && (
                    <RemoveCompanyLookButton
                      entityId={company.id}
                      name={company.name}
                    />
                  )}
                </div>
                <BrandKitPanel
                  tenantId={ctx.tenant.id}
                  entityId={company.id}
                  kit={kit}
                  resolved={resolveBrand({
                    tenantName: ctx.tenant.name,
                    business,
                    company: kit,
                  })}
                  fallbackName={company.name}
                  canWrite={canWrite}
                />
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
