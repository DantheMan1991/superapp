import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { LandedLead, LeadContext, LeadLanding } from "@/lib/leads/types";
import { CrmError } from "./core/errors";
import type { CrmCtx } from "./core/types";
import { createDeal } from "./deal-ops";
import { addAffiliation } from "./party-ops";
import { logActivity } from "./timeline-ops";

/**
 * What CRM does when a stranger arrives (ADR 0042): the record with its
 * source, the person's place at the business, a deal in the pipeline's
 * opening stage when there is something to sell, and a note on the timeline.
 *
 * Runs inside the door's transaction as `staff` with no user — the same
 * standing a member action has, so the policies bound what a form may write.
 * It must never fail the arrival, and it must never let a database error
 * escape (that poisons the transaction around it), so every write that could
 * meet a constraint is checked first: an affiliation is looked up before it
 * is added, and a deal is opened only when the default pipeline exists — an
 * owner makes one on the board's first visit, and until then the record and
 * the note still land and the deal is theirs to open.
 */

async function adoptWithSource(
  tx: Tx,
  ctx: CrmCtx,
  partyId: string,
  source: string,
  sourceDetail: string,
): Promise<void> {
  // The enquiry's shape (ADR 0021): a record CRM has already been asked about
  // keeps the source it has; a first arrival names its own. The detail rides
  // with it under the same rule — a returning customer's record still says
  // where it first came from, which is the fact worth keeping.
  await tx
    .insert(schema.crmPartyDetails)
    .values({ tenantId: ctx.tenantId, partyId, source, sourceDetail })
    .onConflictDoNothing();
}

export const crmLeadLanding: LeadLanding = {
  slug: "crm",
  async land(tx: Tx, lead: LeadContext, arrival: LandedLead): Promise<void> {
    const ctx: CrmCtx = { tenantId: lead.tenantId, userId: lead.userId, role: "staff" };

    await adoptWithSource(tx, ctx, arrival.partyId, arrival.source, arrival.sourceDetail ?? "");

    if (arrival.contactPartyId && arrival.contactPartyId !== arrival.partyId) {
      await adoptWithSource(tx, ctx, arrival.contactPartyId, arrival.source, arrival.sourceDetail ?? "");
      const current = await tx.query.crmAffiliations.findFirst({
        where: and(
          eq(schema.crmAffiliations.tenantId, ctx.tenantId),
          eq(schema.crmAffiliations.personPartyId, arrival.contactPartyId),
          eq(schema.crmAffiliations.organizationPartyId, arrival.partyId),
          isNull(schema.crmAffiliations.endedOn),
        ),
        columns: { id: true },
      });
      if (!current) {
        try {
          // Not primary: the person may already have a primary company, and
          // the partial unique index that keeps "one primary" would refuse a
          // second — inside this transaction, fatally.
          await addAffiliation(tx, ctx, {
            personPartyId: arrival.contactPartyId,
            organizationPartyId: arrival.partyId,
          });
        } catch (err) {
          // A sole trader whose "business" party is themselves, or two
          // organizations by mistake: CRM's own refusal, thrown before any
          // write. Not the lead's problem.
          if (!(err instanceof CrmError)) throw err;
        }
      }
    }

    if (!arrival.proposition) return;

    let dealId: string | null = null;
    try {
      const deal = await createDeal(tx, ctx, {
        partyId: arrival.partyId,
        title: arrival.proposition.title,
        primaryContactPartyId: arrival.contactPartyId ?? null,
      });
      dealId = deal.id;
    } catch (err) {
      const skippable =
        err instanceof CrmError &&
        (err.code === "PIPELINE_NOT_FOUND" ||
          err.code === "PIPELINE_HAS_NO_OPEN_STAGE");
      if (!skippable) throw err;
    }

    if (arrival.proposition.note) {
      await logActivity(tx, ctx, {
        partyId: arrival.partyId,
        dealId,
        kind: "note",
        subject: arrival.proposition.note.subject,
        body: arrival.proposition.note.body,
      });
    }
  },
};
