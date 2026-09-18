import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { AttentionCtx, AttentionItem, AttentionSource } from "@/lib/attention-sources/types";
import { packContext } from "@/lib/packs/tenant-context";
import { formatCents } from "@/lib/money";
import { dateInTimezone } from "@/lib/timezone";
import {
  acceptedProposalAttention,
  daysBetween,
  overdueSelectionAttention,
  subcontractorCoverAttention,
  type SubcontractorCover,
} from "../attention-math";
import { subcontractorStanding } from "../compliance-ops";
import { signedEstimatesAwaiting } from "../estimate-shares";
import { boardExtras } from "../list-ops";
import { listProjects } from "../ops";
import { EXPIRING_SOON_DAYS, PACK, requiredPartyDocumentsFrom, slugLabel } from "../vocabulary";

/**
 * What `jobs` says you still owe: a client's acceptance nobody has answered, a
 * selection past the date the client was asked for, and a subcontractor on a
 * live job whose cover has run out or is about to.
 *
 * The pack's FOURTH attention source after production's, livestock's and
 * inventory's, and the same rules: it imports
 * `@/lib/attention-sources/types` and its own pack, never the registry and
 * never another module. The sentences are built in `attention-math.ts`, pure
 * and tested; this file only READS — and only reads the same things the board
 * and the Subcontractors page already read.
 *
 * ── WHO GETS WHAT ───────────────────────────────────────────────────────────
 *
 * **The acceptance goes to OWNERS ONLY**, because accepting an estimate is an
 * owner's act (`acceptEstimate` takes `requireWrite(ctx, "owner")` and the
 * contract the estimate priced). Telling staff about a decision they cannot
 * make is how a digest earns its way into a filter.
 *
 * **The other two go to everybody.** A selection is chased by whoever is
 * talking to the client, and a trade with no insurance is standing on a site
 * somebody is running today — that is the person most able to send them home.
 *
 * ── WHAT IT COSTS ───────────────────────────────────────────────────────────
 *
 * Four statements plus the board's own grouped reads, whatever the number of
 * jobs: the tenant row, the project list, `boardExtras` over the live ones,
 * `signedEstimatesAwaiting` and `subcontractorStanding` — each grouped in the
 * database and keyed by id. A source that cost a query per job would be a
 * source somebody turns off.
 */
export const jobsAttentionSource: AttentionSource = {
  slug: "jobs-site",
  moduleSlug: PACK,
  label: "Jobs",

  async collect(tx: Tx, ctx: AttentionCtx): Promise<AttentionItem[]> {
    /**
     * The zone and the industry come off the tenant row in one read. The zone
     * turns a signature's timestamp into the day the business would call it,
     * and the industry is what `packContext` needs to resolve the required
     * document list — a tenant VALUE, never this file's opinion.
     */
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, ctx.tenantId),
      columns: { timezone: true, industry: true },
    });
    if (!tenant) return [];

    const projects = await listProjects(tx, ctx.tenantId);
    /**
     * LIVE JOBS ONLY. A completed or cancelled job's overdue selection is a
     * record of what happened, not something anybody still owes — and it would
     * never clear, which is the one thing an obligation may not do.
     */
    const live = projects.filter((p) => p.status !== "complete" && p.status !== "cancelled");

    const pack = await packContext(tx, ctx.tenantId, tenant.industry, PACK);
    const [extras, signed, standing] = await Promise.all([
      boardExtras(
        tx,
        ctx.tenantId,
        live.map((p) => p.id),
        tenant.timezone,
        ctx.today,
      ),
      // Owner-only, so it is not even asked for when nobody could act on it.
      ctx.role === "owner" ? signedEstimatesAwaiting(tx, ctx.tenantId) : Promise.resolve([]),
      subcontractorStanding(tx, ctx.tenantId, requiredPartyDocumentsFrom(pack.config), ctx.today),
    ]);

    const accepted = acceptedProposalAttention(
      signed.map((s) => ({
        estimateId: s.estimateId,
        projectId: s.projectId,
        projectNumber: s.projectNumber,
        projectName: s.projectName,
        number: s.number,
        title: s.title,
        signedName: s.signedName,
        signedOn: dateInTimezone(s.signedAt, tenant.timezone),
        amount: formatCents(s.signedTotalCents),
        movedSince: s.movedSince,
      })),
      ctx.today,
    );

    const selections = overdueSelectionAttention(
      live.map((p) => ({
        projectId: p.id,
        projectNumber: p.number,
        projectName: p.name,
        overdue: extras.get(p.id)?.overdueSelections ?? 0,
      })),
    );

    /**
     * `standingFor` has already decided each required kind's state against
     * today; this only sorts them into the two asks and finds the soonest
     * date among the ones running out. **`missing` counts as lapsed**: a trade
     * with no certificate on file at all is not better off than one whose
     * certificate ran out last week.
     */
    const cover: SubcontractorCover[] = standing.map((p) => {
      const expiring = p.required.filter((r) => r.state === "expiring");
      const dates = expiring
        .map((r) => r.document?.expiresOn)
        .filter((d): d is string => typeof d === "string");
      return {
        partyId: p.partyId,
        partyName: p.partyName,
        projectNumbers: p.projects.map((j) => j.number),
        lapsed: p.required
          .filter((r) => r.state === "expired" || r.state === "missing")
          .map((r) => slugLabel(r.kind)),
        expiring: expiring.map((r) => slugLabel(r.kind)),
        soonestExpiry:
          dates.length === 0
            ? null
            : dates.reduce((a, b) => (daysBetween(ctx.today, b) < daysBetween(ctx.today, a) ? b : a)),
      };
    });

    return [...accepted, ...selections, ...subcontractorCoverAttention(cover)];
  },
};

/** Named so the header's claim about the window is checkable from one place. */
export const COVER_EXPIRING_WITHIN_DAYS = EXPIRING_SOON_DAYS;
