import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { createAsset } from "../src/packs/assets/ops";
import { listItems, receiveStock } from "../src/packs/inventory/ops";
import {
  createChannel,
  moveStockToTruck,
  recordMarketDay,
  setPrice,
} from "../src/packs/retail/ops";

/**
 * **GET THE TILL ON SCREEN.** Same family as `scripts/mail-fixture.ts`.
 *
 * Retail's own dossier has said since slice 1 that *"the market truck has not
 * left a yard"* — and the reason turned out to be reach rather than reluctance.
 * The till lives on a MARKET DAY page and only renders when four things already
 * exist: a channel, a market day, a storage-location asset to sell out of, and
 * priced stock sitting on it. Four screens, in an order nobody guesses, before
 * anything can be clicked.
 *
 * So this builds the chain in one command:
 *
 *   npx tsx --conditions react-server scripts/retail-fixture.ts "Hilltop Farm"
 *
 * **IT REFUSES ANY DATABASE THAT IS NOT THE DEV BRANCH.** It writes through the
 * real ops — the same guards, the same movements, the same stamped costs — so
 * pointing it at production would put invented stock on somebody's books.
 *
 * Idempotent: re-running finds what it already made and moves on.
 */

const TRUCK = "Market truck";
const CHANNEL = "Mount Vernon Farmers Market";

/** Cents, by item name. Anything not listed is left unpriced on purpose. */
const PRICES: Record<string, number> = {
  "Whole broilers": 550,
  "Chicken backs and necks": 300,
};

/** How much to put on the truck, by item name. */
const LOAD: Record<string, number> = {
  "Whole broilers": 40,
  "Chicken backs and necks": 15,
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const tenantName = process.argv[2] ?? "Hilltop Farm";

  /**
   * **THE GUARD IS THE POINT.** `DATABASE_URL` is production in `.env`; the dev
   * branch is `TEST_DATABASE_URL`. Writing fixtures into a real farm's books is
   * the one mistake this script must not be able to make, so it swaps the URL
   * itself rather than trusting whoever runs it.
   */
  const dev = process.env.TEST_DATABASE_URL;
  if (!dev) throw new Error("TEST_DATABASE_URL is not set — refusing to run.");
  if (dev === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL equals DATABASE_URL — refusing to run.");
  }
  process.env.DATABASE_URL = dev;

  const tenant = await withSystem((tx) =>
    tx.query.tenants.findFirst({
      where: eq(schema.tenants.name, tenantName),
      columns: { id: true, name: true },
    }),
  );
  if (!tenant) throw new Error(`no tenant named ${tenantName} on the dev branch`);
  console.log(`tenant: ${tenant.name} (${tenant.id})`);

  const ctx = { tenantId: tenant.id, userId: "retail-fixture", role: "owner" as const };

  await withTenant(
    tenant.id,
    async (tx: Tx) => {
      // ---- the truck ----------------------------------------------------
      let truck = await tx.query.assets.findFirst({
        where: and(
          eq(schema.assets.tenantId, tenant.id),
          eq(schema.assets.name, TRUCK),
        ),
      });
      if (!truck) {
        truck = await createAsset(tx, ctx, {
          kind: "vehicle",
          name: TRUCK,
          // The whole reason the till has no distributed-inventory problem:
          // the truck is an ordinary storage location, so loading it is a
          // transfer and the till draws the truck down locally.
          isStorageLocation: true,
          notes: "Seeded by scripts/retail-fixture.ts",
        });
        console.log(`created truck asset ${truck.id}`);
      } else {
        console.log(`truck already exists (${truck.id})`);
      }

      // ---- the channel --------------------------------------------------
      let channel = await tx.query.retailChannels.findFirst({
        where: and(
          eq(schema.retailChannels.tenantId, tenant.id),
          eq(schema.retailChannels.name, CHANNEL),
        ),
      });
      if (!channel) {
        channel = await createChannel(tx, ctx, {
          name: CHANNEL,
          channelKind: "farmers_market",
          location: "Mount Vernon Square",
        });
        console.log(`created channel ${channel.id}`);
      } else {
        console.log(`channel already exists (${channel.id})`);
      }

      // ---- prices and stock ---------------------------------------------
      const items = await listItems(tx, tenant.id);
      const byName = new Map(items.map((i) => [i.name, i]));

      for (const [name, priceCents] of Object.entries(PRICES)) {
        const item = byName.get(name);
        if (!item) {
          console.log(`! no inventory item named "${name}" — skipping its price`);
          continue;
        }
        await setPrice(tx, ctx, {
          channelId: channel.id,
          itemId: item.id,
          priceCents,
          effectiveFrom: today(),
        });
        console.log(`priced ${name} at ${priceCents}c`);
      }

      for (const [name, quantity] of Object.entries(LOAD)) {
        const item = byName.get(name);
        if (!item) continue;

        // Received into the YARD first, then transferred onto the truck —
        // because that is what actually happens, and because a transfer
        // carries no cost while a receipt does.
        const receipt = await receiveStock(tx, ctx, {
          itemId: item.id,
          newLotCode: `FIXTURE-${today()}-${item.id.slice(0, 4)}`,
          quantity,
          costCents: null,
          occurredOn: today(),
          locationAssetId: null,
        });
        await moveStockToTruck(tx, ctx, {
          itemId: item.id,
          lotId: receipt.lotId,
          quantity,
          truckAssetId: truck.id,
          occurredOn: today(),
        });
        console.log(`loaded ${quantity} × ${name} onto the truck`);
      }

      // ---- the market day the till hangs off -----------------------------
      const existingDay = await tx.query.retailMarketDays.findFirst({
        where: and(
          eq(schema.retailMarketDays.tenantId, tenant.id),
          eq(schema.retailMarketDays.channelId, channel.id),
          eq(schema.retailMarketDays.heldOn, today()),
        ),
      });
      const day =
        existingDay ??
        (await recordMarketDay(tx, ctx, {
          channelId: channel.id,
          heldOn: today(),
          stallFeeCents: 3_500,
          travelCents: 1_800,
          crewSize: 2,
          hours: 5,
          openingFloatCents: 10_000,
        }));
      console.log(
        `\nmarket day ${day.id}\n` +
          `open the till at: /dashboard/m/retail/days/${day.id}`,
      );
    },
    { role: "owner", userId: ctx.userId },
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
