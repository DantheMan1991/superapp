import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { tellSources } from "../src/lib/tell-sources/registry";
import { tellToolFor } from "../src/lib/tell-sources/shape";
import type { TellAction, TellCtx } from "../src/lib/tell-sources/types";
import { createItem } from "../src/packs/inventory/ops";
import { createParcel, createZone } from "../src/packs/land/ops";
import { createLivestockLot } from "../src/packs/livestock/ops";
import { createUnlinkedWork } from "../src/lib/work/entity-work";
import { createProject } from "../src/packs/jobs/ops";
import { TELL_CASES } from "./fixtures/tell-sentences";

/**
 * THE CATALOGUE, AND THE BUDGET IT HAS TO LIVE INSIDE (tell.md, slice A1).
 *
 * Every action a tenant has goes into ONE tool description (`tellToolFor`).
 * Three sources contribute eight actions today; the plan fills sixteen. The
 * failure that arrives with scale is not a crash — it is the model picking a
 * plausible action from the wrong module, which throws nothing, refuses
 * nothing, and draws a perfectly convincing card.
 *
 * `npm run tell:eval` measures the model. THIS measures the thing the model is
 * given, which is the half that can be checked for free on every push:
 *
 *  - no two actions anywhere share a slug,
 *  - an action lives in the source its slug names,
 *  - every `about` carries an example, because that is what the model leans on
 *    hardest when two actions are close,
 *  - every field can be filled — a hint, a unique key, and exactly one way to
 *    answer a choice,
 *  - and the whole thing stays inside a budget.
 *
 * The budget is the point. A catalogue nobody is watching grows one reasonable
 * paragraph at a time, and the first sign is a founder saying it used to work.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/** One action's entry, the way `tellToolFor` writes it. */
const entrySize = (action: TellAction) =>
  tellToolFor([action]).description.length;

d("the catalogue every tenant's model is given", () => {
  const STAMP = `cat-${process.pid}`;
  const SIGNED_IN = `${STAMP}-owner`;

  let tenantId: string;
  let entityId = "";
  let actions: TellAction[] = [];
  let contributing: string[] = [];

  const ctx = (): TellCtx => ({
    tenantId,
    userId: SIGNED_IN,
    role: "owner",
    now: new Date("2026-09-13T15:00:00.000Z"),
    timezone: "UTC",
    industry: "homestead-farm",
    today: "2026-09-13",
  });
  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: SIGNED_IN });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `org_${STAMP}`,
          name: `Catalogue ${STAMP}`,
          slug: STAMP,
          industry: "homestead-farm",
        })
        .returning();
      tenantId = tenant.id;

      // Somebody this business keeps hours for, WITH a sign-in — without the
      // link the time source contributes nothing and the catalogue under test
      // would be two thirds of the real one.
      const [person] = await tx
        .insert(schema.parties)
        .values({ tenantId, kind: "person" as const, displayName: "The Speaker" })
        .returning({ id: schema.parties.id });
      await tx
        .insert(schema.timeWorkers)
        .values({ tenantId, partyId: person.id, clerkUserId: SIGNED_IN });
      // A company to put a job under — the jobs source offers nothing until
      // there is an open project to log against.
      const [entity] = await tx
        .insert(schema.entities)
        .values({ tenantId, name: "Catalogue Builders LLC", isDefault: true })
        .returning({ id: schema.entities.id });
      entityId = entity.id;

      await tx
        .insert(schema.tenantModules)
        .values(
          ["livestock", "inventory", "land", "work", "time", "jobs"].map((moduleId) => ({
            tenantId,
            moduleId,
            enabled: true,
          })),
        )
        .onConflictDoNothing();
    });

    /*
     * ROWS, BECAUSE AN EMPTY SOURCE IS AN ABSENT SOURCE. Every filler declines
     * to offer an action whose every choice would be empty — livestock offers
     * only records with animals still in them, work offers `done` only when
     * something is open. A fixture with no rows measures a catalogue no tenant
     * ever sees.
     */
    await asOwner(async (tx) => {
      await createLivestockLot(tx, ctx(), {
        newItemName: "Broiler chicks",
        code: "Pen 2",
        species: "poultry",
        head: 25,
        arrivedOn: "2026-09-01",
      });
      await createItem(tx, ctx(), {
        name: "Grower crumble",
        itemKind: "feed",
        stockingUnit: "lb",
      });
      const parcel = await createParcel(tx, ctx(), { name: "Home place" });
      await createZone(tx, ctx(), { parcelId: parcel.id, name: "Creek field" });
      await createUnlinkedWork(
        tx,
        { tenantId, userId: SIGNED_IN },
        { title: "Fix the top gate", notes: "", dueOn: null },
      );
      await createProject(
        tx,
        { tenantId, userId: SIGNED_IN, role: "owner" },
        { entityId, number: "24-108", name: "Oak Row residence", status: "active" },
      );
    });

    // Each source asked directly. `proposeTold` would do this too, behind a
    // model call and a cooldown — neither of which this is about.
    actions = await asOwner(async (tx) => {
      const out: TellAction[] = [];
      for (const source of tellSources) out.push(...(await source.actions(tx, ctx())));
      return out;
    });
    contributing = [...new Set(actions.map((a) => a.slug.split(".")[0]))];
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("every source in the registry actually contributed", () => {
    // If one silently contributes nothing the fixture is wrong, not the source
    // — and every assertion below would pass while measuring less than it says.
    expect(contributing.sort()).toEqual(
      [...tellSources].map((s) => s.slug).sort(),
    );
  });

  it("no two actions anywhere share a slug", () => {
    const seen = new Map<string, number>();
    for (const a of actions) seen.set(a.slug, (seen.get(a.slug) ?? 0) + 1);
    expect([...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s)).toEqual([]);
  });

  it("an action lives in the source its slug names", () => {
    for (const source of tellSources) {
      const mine = actions.filter((a) => a.slug.startsWith(`${source.slug}.`));
      expect(mine.length, `${source.slug} contributed no action of its own name`).toBeGreaterThan(0);
    }
    const prefixes = new Set(tellSources.map((s) => s.slug));
    for (const a of actions) {
      expect(prefixes, `${a.slug} names a source that is not in the registry`).toContain(
        a.slug.split(".")[0],
      );
    }
  });

  /**
   * **AN `about` WITHOUT AN EXAMPLE IS A DESCRIPTION OF A DATABASE TABLE.**
   * When two actions are close — "add a job" against "book it", "log a cost"
   * against "record a bill" — the example is what the model leans on, because
   * it is the only part written in the words somebody would actually say.
   */
  it("every action shows the model at least one example sentence", () => {
    for (const a of actions) {
      expect(a.title.trim(), `${a.slug} has no title`).not.toBe("");
      expect(a.about.trim(), `${a.slug} has no about`).not.toBe("");
      expect(
        /[“"][^”"]{6,}[”"]/.test(a.about),
        `${a.slug}'s about carries no quoted example — add one in the words somebody would say`,
      ).toBe(true);
    }
  });

  it("every field can be filled", () => {
    for (const a of actions) {
      const keys = new Set<string>();
      for (const f of a.fields) {
        expect(f.key.trim(), `${a.slug} has a field with no key`).not.toBe("");
        expect(keys.has(f.key), `${a.slug} declares ${f.key} twice`).toBe(false);
        keys.add(f.key);
        expect(f.label.trim(), `${a.slug}.${f.key} has no label`).not.toBe("");
        expect(
          f.hint.trim(),
          `${a.slug}.${f.key} has no hint — the hint IS the model's instruction`,
        ).not.toBe("");

        if (f.kind === "choice") {
          const ways = [f.choices !== undefined, f.find !== undefined].filter(Boolean).length;
          expect(
            ways,
            `${a.slug}.${f.key} is a choice with ${ways} ways to answer it — it needs exactly one of choices or find`,
          ).toBe(1);
        }
      }
    }
  });

  /**
   * THE BUDGET. Both halves matter and they fail differently: one long `about`
   * is a writing problem, and forty reasonable ones are an architecture
   * problem. The numbers have headroom — they are a tripwire, not a target —
   * and the right response to either is to read the harness, not to raise them.
   */
  it("stays inside a budget, per action and in total", () => {
    for (const a of actions) {
      expect(
        entrySize(a),
        `${a.slug} writes ${entrySize(a)} characters into every sentence's prompt. Tighten the about, or split the action.`,
      ).toBeLessThan(1_600);
    }

    const total = tellToolFor(actions).description.length;
    expect(
      total,
      `the catalogue is ${total} characters for ${actions.length} actions. Past this, selection accuracy is a measurement (npm run tell:eval), never a hunch — see docs/modules/tell.md slice A1.`,
    ).toBeLessThan(40_000);
  });

  /**
   * **THE TRAP THIS FILE EXISTS TO CLOSE, AND IT CAUGHT ITS OWN AUTHOR.** The
   * runner skips a case whose `needs` are not all contributing. On the golden
   * set’s first run four of twenty-two cases named `land` and `inventory` —
   * real MODULES, but not tell SOURCES — so they never ran, and the accuracy
   * figure read 18/18 by quietly dropping its hardest cases. A skipped case
   * scores as neither pass nor fail, which is the worst of the three.
   */
  it("every source a case needs is a source that exists", () => {
    const known = new Set(tellSources.map((s) => s.slug));
    for (const c of TELL_CASES) {
      for (const need of c.needs) {
        expect(
          known,
          `"${c.said}" needs "${need}", which is not a tell source — the case would be skipped, never run, and never counted`,
        ).toContain(need);
      }
    }
  });

  /**
   * **THE CEILING, AND WHETHER IT IS ACTUALLY GONE** (tell.md, slice A3).
   *
   * `work.done` used to write every open job into the model's prompt, which is
   * the shape ADR 0052 forbids for a list that can pass a few dozen — and a
   * to-do list is the list in this product most certain to. It made the
   * catalogue's size a function of how busy the business is.
   *
   * Measuring that on the pilot farm proved nothing: it has two open jobs, so
   * enumerating them was cheap and the change read as 105 characters WORSE.
   * The win is not a saving, it is a slope — so the slope is what is asserted.
   */
  it("does not grow with the number of open jobs", async () => {
    const before = tellToolFor(actions).description.length;

    await asOwner(async (tx) => {
      for (let i = 0; i < 60; i++) {
        await createUnlinkedWork(
          tx,
          { tenantId, userId: SIGNED_IN },
          {
            title: `Check the water in paddock ${i}`,
            notes: "",
            dueOn: null,
          },
        );
      }
    });

    const after = await asOwner(async (tx) => {
      const out: TellAction[] = [];
      for (const source of tellSources) out.push(...(await source.actions(tx, ctx())));
      return tellToolFor(out).description.length;
    });

    // Sixty jobs at ~30 characters each is ~1,800 the old shape would have
    // added. Nothing is allowed to scale with them now — a little slack for
    // an action appearing at all, and none for its contents.
    expect(
      after - before,
      `the catalogue grew ${after - before} characters for 60 more jobs — something is enumerating again`,
    ).toBeLessThan(50);
  });
  it("the golden set names actions that exist", () => {
    const have = new Set(actions.map((a) => a.slug));
    const reachable = TELL_CASES.filter((c) =>
      c.needs.every((n) => contributing.includes(n)),
    );
    const missing = [
      ...new Set(
        reachable
          .flatMap((c) => [...c.expect, ...(c.tolerate ?? []).flat()])
          .filter((slug) => !have.has(slug)),
      ),
    ];
    expect(
      missing,
      "the golden set expects actions this catalogue does not have — a renamed slug silently stops being measured",
    ).toEqual([]);
  });
});
