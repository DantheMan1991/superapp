import type { ModuleDefinition } from "./types";
import { AccountingModule } from "./accounting/AccountingModule";
import { CrmModule } from "./crm/CrmModule";
import { DocumentsModule } from "./documents/DocumentsModule";
import { EmailModule } from "./email/EmailModule";
import { HelloModule } from "./hello/HelloModule";

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
};

export function getModuleDefinition(slug: string): ModuleDefinition | null {
  return moduleRegistry[slug] ?? null;
}
