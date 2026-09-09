import "server-only";
import { schema, type Tx } from "@/db";
import { hasAny } from "@/lib/setup-sources/has-any";
import type { SetupCtx, SetupSource, SetupStep } from "@/lib/setup-sources/types";

/**
 * What CRM is waiting for: anybody at all.
 *
 * A record IS a party — the shared spine that Accounting's customers and
 * vendors also live on — so this clears the moment a customer is typed onto an
 * invoice or a vendor onto a bill, not only when somebody opens CRM. That is
 * right: the module has people in it either way.
 *
 * Deliberately one step and no more. "Add your first deal" or "set up a
 * pipeline" is advice, and a business that never runs a pipeline would see it
 * forever (ADR 0033).
 */
export const crmSetupSource: SetupSource = {
  slug: "crm-people",
  moduleSlug: "crm",
  label: "CRM",

  async collect(tx: Tx, ctx: SetupCtx): Promise<SetupStep[]> {
    if (await hasAny(tx, schema.parties, ctx.tenantId)) return [];
    return [
      {
        key: "crm.people",
        title: "Add the people you work with",
        detail:
          "Customers, suppliers and contacts all live here, and invoices and bills pick from this list.",
        href: "/dashboard/m/crm/records/new",
        cta: "Add a record",
        guide: "crm/new-record",
      },
    ];
  },
};
