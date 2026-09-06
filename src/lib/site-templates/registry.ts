import { homesteadFarmSiteTemplate } from "@/industries/homestead-farm/site-template";
import { generalSiteTemplate } from "./general";
import type { SiteTemplate } from "./types";

/**
 * Which industries bring a website template (slice 15, ADR 0030).
 *
 * **THIS FILE EXISTS SO THAT THE SITE NEVER NAMES AN INDUSTRY**, the job
 * `src/lib/site-blocks/registry.ts` does for packs and
 * `src/lib/basis-lens/registry.ts` for the basis lens: a registry may know
 * that several things exist; no individual module may. Marketing imports
 * `@/lib/site-templates/resolve`; an industry is named here and nowhere
 * else in that chain. The general template is the platform's own and is
 * what a business with no profile, or a profile with no template, gets.
 */
export const SITE_TEMPLATES: SiteTemplate[] = [generalSiteTemplate, homesteadFarmSiteTemplate];
