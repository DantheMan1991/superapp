import type { LeadLanding } from "./types";
import { crmLeadLanding } from "@/modules/crm/leads";

/**
 * The one file that knows which module fills the slot (ADR 0042). A registry
 * may know several modules exist; no door and no module may know another —
 * the rule `src/packs/index.ts` and every registry beside this one live by.
 */
export const leadLandings: readonly LeadLanding[] = [crmLeadLanding];
