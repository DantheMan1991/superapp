import type { Tx } from "@/db";

/**
 * A stranger's arrival is a lead the CRM fills in (ADR 0042).
 *
 * Three public doors write into a tenant — the site's enquiry form, its
 * booking form, and the health check — and each ends with the same question:
 * now that the party exists, what does the CRM want to know? The CRM's
 * answer is its own business (a record with a source; a deal when there is
 * something to sell; a note), and none of the doors may import the CRM to
 * ask. So the door names a slot, the CRM fills it, and `registry.ts` is the
 * one file that knows which module answers — the arrangement every registry
 * under src/lib/ lives by.
 *
 * TYPES ONLY. Filling this drags nothing into a bundle.
 */
export interface LandedLead {
  /** The party the lead is about — the organization when there is one. */
  partyId: string;
  /** The person to talk to, when known and distinct from `partyId`. */
  contactPartyId?: string;
  /** An open word beside `website` and `referral`: a source, never a kind. */
  source: string;
  /**
   * Present when the stranger asked about buying something — a title for the
   * deal a pipeline would open, and a note for its timeline. Absent for a
   * plain message, which lands as a record and nothing more.
   */
  proposition?: {
    title: string;
    note?: { subject: string; body: string };
  };
}

export interface LeadContext {
  tenantId: string;
  /** Empty for a public door: nobody is at the keyboard. */
  userId: string;
}

export interface LeadLanding {
  /** The feature that must be switched on for `land` to run at all. */
  slug: string;
  /**
   * Runs INSIDE the door's transaction, after the party exists. Must not
   * open a transaction, must not call withTenant, and must never fail the
   * arrival: a pipeline that does not exist yet is a deal not opened, not a
   * message lost. In particular it must not let a database error escape —
   * inside a transaction that poisons everything after it — so anything that
   * could violate a constraint is checked before it is written.
   */
  land(tx: Tx, ctx: LeadContext, lead: LandedLead): Promise<void>;
}
