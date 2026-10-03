import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { allWeighins } from "@/modules/health/body-ops";
import { PhotoCompare } from "@/modules/health/photos/photo-compare";

export const dynamic = "force-dynamic";

/**
 * PROGRESS PHOTOS, COMPARED (docs/help/health/photos.md, H2b): the photos are
 * on this phone (ADR 0128), so the page sends only the weigh-ins, for the
 * trend on each day; the screen reads the photos from the phone itself.
 */
export default async function PhotosPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "health");
  const today = todayInTimezone(ctx.tenant.timezone);
  const weighins = await withTenant(ctx.tenant.id, (tx) => allWeighins(tx, ctx.tenant.id), { role: ctx.role });
  return <PhotoCompare owner={ctx.tenant.id} today={today} weighins={weighins} />;
}
