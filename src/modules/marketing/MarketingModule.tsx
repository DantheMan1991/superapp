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
import { MarketingStrip } from "./components/marketing-strip";

/**
 * The module's front page: the brand kit, with the strip to the website.
 *
 * The data is Layer 0 (`brand_kits`, read through `src/lib/brand/`); this is
 * the one place it is EDITED. The website lives at `./website`; the kit
 * stayed at the module root when the strip arrived (slice 1) so the brand
 * guide's route and every link to it kept working.
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
  // What a company kit's blank look falls back to: the business kit's answers.
  const businessLook = resolveBrand({ tenantName: ctx.tenant.name, business, company: null });
  const inherits = { look: businessLook.look, fontPairing: businessLook.fontPairing, buttonShape: businessLook.buttonShape };

  return (
    <div className="space-y-8">
      <PageHeader
        icon={<Megaphone />}
        title="Marketing"
        description={`How ${ctx.tenant.name} looks to its customers: the brand kit on every invoice, and the website.`}
      />
      <MarketingStrip />

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
          inherits={null}
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
                  inherits={inherits}
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
