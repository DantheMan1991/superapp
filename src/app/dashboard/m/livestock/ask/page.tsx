import { Sparkles } from "lucide-react";
import { LivestockNav } from "@/packs/livestock/components/livestock-nav";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { packContext } from "@/lib/packs/tenant-context";
import { todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { listLots, movementKindsForLots } from "@/packs/inventory/ops";
import { listZones } from "@/packs/land/ops";
import { listLivestockLots } from "@/packs/livestock/ops";
import { summariseHead } from "@/packs/livestock/core/herd";
import { starterQuestions } from "@/packs/livestock/core/digest";
import { speciesFrom } from "@/packs/livestock/vocabulary";
import { AdvisorChat } from "@/packs/livestock/components/advisor-chat";

export const dynamic = "force-dynamic";

/**
 * Ask the advisor — livestock slice 1b, and the half of the day-one wedge that
 * needs no records at all.
 *
 * The design's cold-start argument in one screen: FCR trends, sire comparison
 * and rest analysis all produce nothing until a season has been recorded, so if
 * the first useful thing this pack does requires history, nobody gets to the
 * history. This page is useful on the day a tenant is created and gets better
 * every time something is entered — which is the same curve the recording habit
 * follows, deliberately.
 *
 * **The page fetches almost nothing.** The farm digest is assembled inside the
 * action, per question, so an answer is never given from a snapshot taken when
 * the tab was opened. What is read here is only enough to suggest what to ask.
 */
export default async function AdvisorPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "livestock");

  const today = todayInTimezone(ctx.tenant.timezone);

  const { species, sampleLotCode, hasZones } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [lots, pack, zones] = await Promise.all([
        listLivestockLots(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "livestock"),
        listZones(tx, ctx.tenant.id, { status: "active" }),
      ]);
      const inventoryLotIds = lots.map((l) => l.inventoryLotId);
      const [inventoryLots, movements] = await Promise.all([
        listLots(tx, ctx.tenant.id),
        movementKindsForLots(tx, ctx.tenant.id, inventoryLotIds),
      ]);
      const byId = new Map(inventoryLots.map((l) => [l.id, l]));
      // The biggest live lot, so the suggested question is about the animals
      // somebody actually thinks about rather than a lot that has gone.
      const live = lots
        .map((lot) => ({
          code: byId.get(lot.inventoryLotId)?.code ?? null,
          head: summariseHead(movements.get(lot.inventoryLotId) ?? []).balance,
        }))
        .filter((row) => row.code !== null && row.head > 0)
        .sort((a, b) => b.head - a.head);
      return {
        species: speciesFrom(pack.config),
        sampleLotCode: live[0]?.code ?? null,
        hasZones: zones.length > 0,
      };
    },
    { role: ctx.role },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Sparkles />}
        title="Ask"
        description={`Husbandry questions, answered against your own records as of ${today}.`}
      />

      <LivestockNav />

      <AdvisorChat
        starters={starterQuestions({ species, sampleLotCode, hasZones })}
      />
    </div>
  );
}
