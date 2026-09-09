import { describe, expect, it } from "vitest";
import { collectSetup } from "../src/lib/setup-sources/resolve";
import type { SetupCtx, SetupSource, SetupStep } from "../src/lib/setup-sources/types";
import type { Tx } from "../src/db";

/**
 * The resolve layer. Pure — sources are injected, so no database and always
 * runs. The real sources are exercised in `setup-sources-db.test.ts`.
 *
 * The behaviour under test is the one that makes the Overview's card
 * trustworthy: a source that fails must be REPORTED, never folded into an
 * empty list, because an empty list is what "set up" looks like.
 */

const CTX: SetupCtx = { tenantId: "t1" };

// The resolve layer never touches the tx — it hands it straight to sources.
const TX = {} as Tx;

function source(slug: string, collect: SetupSource["collect"], label = slug.toUpperCase()): SetupSource {
  return { slug, moduleSlug: slug, label, collect };
}

function step(key: string, over: Partial<SetupStep> = {}): SetupStep {
  return {
    key,
    title: key,
    detail: "",
    href: `/x/${key}`,
    cta: "Do",
    guide: null,
    ...over,
  };
}

describe("collectSetup", () => {
  it("keeps registry order, then each source's own order, and stamps the section", async () => {
    const result = await collectSetup(TX, CTX, [
      source("b", async () => [step("b1"), step("b2")], "Bee"),
      source("a", async () => [step("a1")], "Ay"),
    ]);
    expect(result.steps.map((s) => s.key)).toEqual(["b1", "b2", "a1"]);
    expect(result.steps.map((s) => s.section)).toEqual(["Bee", "Bee", "Ay"]);
    expect(result.complete).toBe(true);
    expect(result.failed).toEqual([]);
  });

  it("a source with nothing to ask for contributes nothing and is still complete", async () => {
    const result = await collectSetup(TX, CTX, [source("a", async () => [])]);
    expect(result.steps).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it("REPORTS a throwing source instead of returning an empty list", async () => {
    // The whole point. Folding this to [] would render no card, and no card
    // means "set up" — about a business whose Inventory could not be asked.
    const result = await collectSetup(TX, CTX, [
      source("inventory", async () => [step("inventory.items")], "Inventory"),
      source("accounting", async () => {
        throw new Error("connection reset");
      }, "Accounting"),
    ]);
    expect(result.steps.map((s) => s.key)).toEqual(["inventory.items"]);
    expect(result.complete).toBe(false);
    expect(result.failed).toEqual([{ slug: "accounting", label: "Accounting", reason: "error" }]);
  });

  it("one broken source does not stop the others answering", async () => {
    const result = await collectSetup(TX, CTX, [
      source("a", async () => {
        throw new Error("boom");
      }),
      source("b", async () => [step("b1")]),
      source("c", async () => [step("c1")]),
    ]);
    expect(result.steps.map((s) => s.key)).toEqual(["b1", "c1"]);
    expect(result.failed).toHaveLength(1);
  });

  it("a source that never answers is reported as a timeout, and the rest still render", async () => {
    const result = await collectSetup(
      TX,
      CTX,
      [
        source("slow", () => new Promise<SetupStep[]>(() => {})),
        source("quick", async () => [step("q1")]),
      ],
      { timeoutMs: 20 },
    );
    expect(result.steps.map((s) => s.key)).toEqual(["q1"]);
    expect(result.failed).toEqual([{ slug: "slow", label: "SLOW", reason: "timeout" }]);
    expect(result.complete).toBe(false);
  });

  it("an empty list with a failure is NOT complete — the card must say so rather than vanish", async () => {
    const result = await collectSetup(TX, CTX, [
      source("a", async () => {
        throw new Error("boom");
      }),
    ]);
    expect(result.steps).toEqual([]);
    expect(result.complete).toBe(false);
  });
});
