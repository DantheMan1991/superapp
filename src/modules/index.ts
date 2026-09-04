import type { ModuleDefinition } from "./types";
import { AccountingModule } from "./accounting/AccountingModule";
import { CrmModule } from "./crm/CrmModule";
import { DocumentsModule } from "./documents/DocumentsModule";
import { EmailModule } from "./email/EmailModule";
import { HelloModule } from "./hello/HelloModule";
import { MarketingModule } from "./marketing/MarketingModule";
import { SchedulingModule } from "./scheduling/SchedulingModule";
import { WorkModule } from "./work/WorkModule";

/**
 * Code-side module registry: slug → how it renders. The DB `modules` table
 * decides what exists and what's switched on per tenant; this map is the
 * implementation seam where real modules (accounting, CRM, …) get added in
 * Phase 2 without touching the shell.
 */
export const moduleRegistry: Record<string, ModuleDefinition> = {
  hello: {
    slug: "hello",
    name: "Hello Module",
    icon: "sparkles",
    Component: HelloModule,
  },
  accounting: {
    slug: "accounting",
    name: "Accounting",
    icon: "calculator",
    Component: AccountingModule,
  },
  crm: {
    slug: "crm",
    name: "CRM",
    icon: "contact",
    Component: CrmModule,
  },
  documents: {
    slug: "documents",
    name: "Documents",
    icon: "folder",
    Component: DocumentsModule,
  },
  email: {
    slug: "email",
    name: "Mail",
    icon: "mail",
    // The one surface in the product that reads as a list beside a detail
    // pane; the shell's centred column would spend half a monitor on margin.
    layout: "full",
    Component: EmailModule,
  },
  // Registered from slice 1 so the UI has somewhere to live, while the seed row
  // stays `coming_soon` — a superadmin can switch it on for one tenant to try
  // it, and nobody is sold it. Slice 4 flips the seed row.
  scheduling: {
    slug: "scheduling",
    name: "Scheduling",
    icon: "calendar",
    Component: SchedulingModule,
  },
  // Registered from slice 1, while the seed row stays `coming_soon` — the same
  // arrangement scheduling used. A superadmin can switch it on for one tenant
  // to try it, and nobody is sold it. Slice 4 flips the seed row.
  work: {
    slug: "work",
    name: "Work",
    icon: "check-square",
    Component: WorkModule,
  },
  // Registered from slice 0 (the brand kit) while the seed row stays
  // `coming_soon`, the arrangement scheduling and work used: a superadmin can
  // switch it on for one tenant, and nobody is sold it until the website and
  // domains slices make it a marketing tool rather than a settings page.
  marketing: {
    slug: "marketing",
    name: "Marketing",
    icon: "megaphone",
    Component: MarketingModule,
  },
};

export function getModuleDefinition(slug: string): ModuleDefinition | null {
  return moduleRegistry[slug] ?? null;
}
