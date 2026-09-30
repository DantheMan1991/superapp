import { z } from "zod";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { isSynthesisConfigured } from "@/lib/speech/synthesis";
import { getPostureCheck, listPostureChecks } from "@/modules/fitness/posture/check-ops";
import { summarize } from "@/modules/fitness/posture/core/history";
import { PostureCheck } from "@/modules/fitness/posture/components/posture-check";

export const dynamic = "force-dynamic";

/**
 * THE POSTURE CHECK (docs/help/fitness/posture-check.md; docs/modules/
 * posture.md, slices 2 and 3b): full screen, the camera on the phone and
 * nothing leaving it but numbers (ADR 0118). The check's numbers, and its
 * photos if the person keeps them, are stored on the phone under this personal
 * space's id, so a second person signed in on the same browser does not see
 * them; the numbers then go to the account.
 *
 * From the account, two things the check needs (3b): where each sticker sat on
 * the latest check, to notice one that slipped; and, with `?repeatOf=`, the
 * check this one repeats with the stickers put back on.
 */
export default async function PostureCheckPage({ searchParams }: { searchParams: Promise<{ repeatOf?: string }> }) {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  const { repeatOf: asked } = await searchParams;
  const repeatId = z.string().uuid().safeParse(asked);

  const { latest, original } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      latest: (await listPostureChecks(tx, ctx.tenant.id))[0] ?? null,
      original: repeatId.success ? await getPostureCheck(tx, ctx.tenant.id, repeatId.data) : null,
    }),
    { role: ctx.role },
  );

  return (
    <PostureCheck
      owner={ctx.tenant.id}
      naturalVoice={isSynthesisConfigured()}
      backHref="/personal/m/fitness/posture"
      reportHref="/personal/m/fitness/posture/checks"
      setupHref="/personal/m/fitness/posture/setup"
      // Pictures or a film instead of the camera, to drive the check on a
      // laptop: never in production.
      testSources={process.env.NODE_ENV !== "production"}
      repeatOf={original ? { id: original.id, takenAt: original.takenAt } : null}
      // "Last time" is the check being repeated, for a repeat: its stickers are the ones to match.
      lastPlaces={original ? summarize(original).places : latest ? summarize(latest).places : null}
    />
  );
}
