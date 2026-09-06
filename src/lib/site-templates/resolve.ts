import { generalSiteTemplate } from "./general";
import { SITE_TEMPLATES } from "./registry";
import type { SiteTemplate } from "./types";

/** The template a tenant builds with: its industry's, else the general one. `tenants.industry` is `general` when no profile is installed. */
export function templateFor(industry: string | null | undefined): SiteTemplate {
  if (!industry) return generalSiteTemplate;
  return SITE_TEMPLATES.find((t) => t.industry === industry) ?? generalSiteTemplate;
}

export function listSiteTemplates(): SiteTemplate[] {
  return SITE_TEMPLATES;
}
