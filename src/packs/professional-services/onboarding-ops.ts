import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import {
  createWorkForEntity,
  listWorkForEntity,
  type EntityWorkRow,
} from "@/lib/work/entity-work";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import {
  dueDateFor,
  onboardingListsFrom,
  scheduleFrom,
  stepsToRaise,
  type OnboardingStep,
} from "./core/onboarding";
import { EngagementError, getEngagement, PACK, type EngagementCtx } from "./ops";

/**
 * Starting an engagement's onboarding (back-office slice 7c).
 *
 * **NO NEW TABLE, AND NO MIGRATION.** The work items themselves are the
 * record: what has been raised is what is linked to the engagement, so
 * `stepsToRaise` compares the profile's steps against the titles already
 * there. That makes the button additive and re-runnable — the discipline
 * `provisionAccounting` and the profile seed applier already have — and it
 * leaves nothing to drift out of step with the work list.
 *
 * The link is P3 (`work_item_links` carries `extension_slug` and an
 * unconstrained `entity_type`), so registering `engagement` as a linkable
 * record needed no change to core.
 */

/** The linkable record type this pack registers (P3). */
export const ENGAGEMENT_ENTITY = "engagement";

export interface OnboardingPreview {
  /** Steps that pressing the button would add. */
  missing: OnboardingStep[];
  /** Work already raised against this engagement, newest due first. */
  work: EntityWorkRow[];
  /** True when the profile contributes no list for this engagement's kind. */
  noListConfigured: boolean;
}

/**
 * The engagement's onboarding as the page needs it: what is already raised,
 * and what pressing the button would add.
 */
export async function previewOnboarding(
  tx: Tx,
  tenantId: string,
  industry: string,
  engagement: { id: string; kind: string },
): Promise<OnboardingPreview> {
  const [pack, work] = await Promise.all([
    packContext(tx, tenantId, industry, PACK),
    listWorkForEntity(tx, { tenantId }, { entityType: ENGAGEMENT_ENTITY, entityId: engagement.id }),
  ]);
  const lists = onboardingListsFrom(pack.config);
  const missing = stepsToRaise(lists, engagement.kind, work.map((w) => w.title));
  return {
    missing,
    work,
    noListConfigured: lists.length === 0,
  };
}


export interface RaisedOnboarding {
  raised: { itemId: string; title: string }[];
}

/**
 * Raise whatever the profile's list says is missing.
 *
 * OWNER-level: it puts work on other people's lists, which is a decision — the
 * same call `raiseDueMaintenance` makes in the assets pack. Ticking the items
 * off afterwards is member-level, because the shared verbs ask the OWNING
 * feature's rule and a pack admits a member (src/lib/packs/authorize.ts).
 *
 * Work being switched off does not stop this. The guard is the owning feature
 * (extension-model.md §4b): the item simply has no second home to appear in.
 */
export async function startOnboarding(
  tx: Tx,
  ctx: EngagementCtx,
  args: { engagementId: string; today: string },
): Promise<RaisedOnboarding> {
  if (!allowsWrite(ctx.role, "owner")) {
    throw new EngagementError("FORBIDDEN", "only an owner can start onboarding");
  }
  const engagement = await getEngagement(tx, ctx.tenantId, args.engagementId);
  if (!engagement) throw new EngagementError("NOT_FOUND", "engagement not found");
  if (engagement.status === "ended") {
    throw new EngagementError("ENDED", "that engagement has ended");
  }

  const tenant = await tx.query.tenants.findFirst({
    where: eq(schema.tenants.id, ctx.tenantId),
    columns: { industry: true },
  });
  const preview = await previewOnboarding(tx, ctx.tenantId, tenant?.industry ?? "", engagement);
  const from = scheduleFrom(engagement.startsOn, args.today);

  const raised: RaisedOnboarding["raised"] = [];
  for (const step of preview.missing) {
    const itemId = await createWorkForEntity(
      tx,
      { tenantId: ctx.tenantId, userId: ctx.userId },
      { extensionSlug: PACK, entityType: ENGAGEMENT_ENTITY, entityId: engagement.id },
      {
        title: step.title,
        notes: step.notes,
        dueOn: dueDateFor(step, from),
      },
    );
    raised.push({ itemId, title: step.title });
  }
  return { raised };
}
