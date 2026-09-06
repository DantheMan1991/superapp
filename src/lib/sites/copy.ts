/**
 * What a writer is told about a business — pure. Facts, never files.
 *
 * The pages themselves come from a template (`src/lib/site-templates`,
 * slice 15); this file kept only the brief when the fixed three-page
 * assembler and its standard copy moved into the general template.
 */
export interface SiteBrief {
  name: string;
  tagline: string;
  /** The industry profile's readable name, or null for a general business. */
  industry: string | null;
  phone: string;
  email: string;
  address: string;
  hoursLines: string[];
}

export type { AssembledPage } from "@/lib/site-templates/types";
