import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { isSynthesisConfigured } from "@/lib/speech/synthesis";
import { PostureCheck } from "@/modules/fitness/posture/components/posture-check";

export const dynamic = "force-dynamic";

/**
 * THE POSTURE CHECK (docs/help/fitness/posture-check.md; docs/modules/
 * posture.md, slice 2): full screen, the camera on the phone and nothing
 * leaving it (ADR 0118). The check's numbers, and its photos if the person
 * keeps them, are stored on the phone under this personal space's id, so a
 * second person signed in on the same browser does not see them.
 */
export default async function PostureCheckPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
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
    />
  );
}
