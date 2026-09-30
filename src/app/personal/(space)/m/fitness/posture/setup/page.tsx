import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { isSynthesisConfigured } from "@/lib/speech/synthesis";
import { SetupCheck } from "@/modules/fitness/posture/components/setup-check";

export const dynamic = "force-dynamic";

/**
 * CHECK YOUR SETUP (docs/help/fitness/posture-setup.md; docs/modules/
 * posture.md, slice 1): full screen, the camera on the phone and nothing
 * leaving it (ADR 0118). The coach's recorded voice when the platform has one.
 */
export default async function PostureSetupPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  return (
    <SetupCheck
      naturalVoice={isSynthesisConfigured()}
      backHref="/personal/m/fitness/posture"
      // A picture or a film instead of the camera, to drive the check on a
      // laptop: never in production.
      testSources={process.env.NODE_ENV !== "production"}
    />
  );
}
