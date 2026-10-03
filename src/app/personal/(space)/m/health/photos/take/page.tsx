import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { isSynthesisConfigured } from "@/lib/speech/synthesis";
import { todayInTimezone } from "@/lib/timezone";
import { PhotoTake } from "@/modules/health/photos/photo-take";

export const dynamic = "force-dynamic";

/**
 * TAKING PROGRESS PHOTOS (docs/help/health/photos-take.md, H2b): the camera
 * on the phone, the photos kept on the phone (ADR 0128). The page tells the
 * screen the space's day they are kept under, and whether the recorded voice
 * is set up for the countdown.
 */
export default async function TakePhotosPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "health");
  return (
    <PhotoTake owner={ctx.tenant.id} today={todayInTimezone(ctx.tenant.timezone)} naturalVoice={isSynthesisConfigured()} />
  );
}
