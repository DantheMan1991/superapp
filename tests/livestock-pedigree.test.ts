import { describe, expect, it } from "vitest";
import {
  MAX_GENERATIONS,
  ancestorTree,
  combine,
  formatComposition,
  formatShare,
  isAncestor,
  resolveComposition,
  statedComposition,
  type BreedPart,
  type PedigreeIndex,
  type PedigreeNode,
} from "../src/packs/livestock/core/pedigree";
import { slugLabel } from "../src/packs/inventory/vocabulary";

/**
 * Livestock slice 4a — what an animal is made of, and who made it.
 *
 * The claim worth certifying is one sentence, and every other test here exists
 * to stop it being quietly broken:
 *
 * > **An unknown parent is HALF the animal, not nothing.**
 *
 * Renormalising the known half up to a whole is the tempting bug — it makes a
 * herd read purer on paper with every generation, and it is wrong in the
 * direction that costs somebody money when they sell. Alongside it:
 *
 *   1. **The arithmetic is exact**, because it is integers over a common
 *      denominator. Three generations of halving must still add up.
 *   2. **A stated composition beats a computed one** — papers in a drawer
 *      outrank the app's arithmetic.
 *   3. **A pedigree loop terminates**, whatever the write path let through.
 */

const node = (over: Partial<PedigreeNode> & { id: string }): PedigreeNode => ({
  damLotId: null,
  sireLotId: null,
  stated: [],
  ...over,
});

/** An index from a list, so a test reads as a herd rather than as a Map. */
const indexOf = (nodes: PedigreeNode[]): PedigreeIndex =>
  new Map(nodes.map((n) => [n.id, n]));

const purebred = (id: string, breed: string): PedigreeNode =>
  node({ id, stated: [{ breed, parts: 1 }] });

/** `½ angus` etc., without dragging a label function into every assertion. */
const shares = (parts: BreedPart[], denominator: number): string[] =>
  parts.map((p) => `${formatShare(p.parts, denominator)} ${p.breed}`);

describe("statedComposition", () => {
  it("is null when nobody has said anything", () => {
    expect(statedComposition([])).toBeNull();
  });

  it("reduces to the smallest exact statement", () => {
    const stated = statedComposition([
      { breed: "angus", parts: 2 },
      { breed: "hereford", parts: 2 },
    ])!;
    expect(stated.denominator).toBe(2);
    expect(shares(stated.parts, stated.denominator)).toEqual([
      "½ angus",
      "½ hereford",
    ]);
  });

  it("holds a three-way cross without rounding it", () => {
    const stated = statedComposition([
      { breed: "angus", parts: 1 },
      { breed: "hereford", parts: 1 },
      { breed: "simmental", parts: 1 },
    ])!;
    // The percentage form of this is 33/33/34 and the extra point is a claim
    // nobody made. Thirds stay thirds.
    expect(stated.denominator).toBe(3);
    expect(stated.parts.every((p) => p.parts === 1)).toBe(true);
    expect(stated.unknownParts).toBe(0);
  });

  it("merges a breed stated twice rather than picking one", () => {
    const stated = statedComposition([
      { breed: "angus", parts: 1 },
      { breed: "angus", parts: 1 },
      { breed: "hereford", parts: 2 },
    ])!;
    expect(shares(stated.parts, stated.denominator)).toEqual([
      "½ angus",
      "½ hereford",
    ]);
  });

  it("drops a part of zero or less, which is not a component of anything", () => {
    const stated = statedComposition([
      { breed: "angus", parts: 3 },
      { breed: "hereford", parts: 0 },
      { breed: "simmental", parts: -1 },
    ])!;
    expect(stated.parts).toEqual([{ breed: "angus", parts: 1 }]);
  });
});

describe("combine", () => {
  it("takes half from each parent", () => {
    const dam = statedComposition([{ breed: "angus", parts: 1 }])!;
    const sire = statedComposition([{ breed: "hereford", parts: 1 }])!;
    const calf = combine(dam, sire);
    expect(shares(calf.parts, calf.denominator)).toEqual([
      "½ angus",
      "½ hereford",
    ]);
    expect(calf.source).toBe("computed");
  });

  it("adds the shares when both parents carry the same breed", () => {
    const dam = statedComposition([{ breed: "angus", parts: 1 }])!;
    const sire = statedComposition([
      { breed: "angus", parts: 1 },
      { breed: "hereford", parts: 1 },
    ])!;
    const calf = combine(dam, sire);
    expect(shares(calf.parts, calf.denominator)).toEqual([
      "¾ angus",
      "¼ hereford",
    ]);
  });

  it("finds a common denominator rather than approximating one", () => {
    const dam = statedComposition([
      { breed: "angus", parts: 1 },
      { breed: "hereford", parts: 1 },
      { breed: "simmental", parts: 1 },
    ])!;
    const sire = statedComposition([{ breed: "angus", parts: 1 }])!;
    const calf = combine(dam, sire);
    // Thirds halved against a whole: sixths, exactly.
    expect(calf.denominator).toBe(6);
    expect(shares(calf.parts, calf.denominator)).toEqual([
      "⅔ angus",
      "1/6 hereford",
      "1/6 simmental",
    ]);
  });
});

describe("resolveComposition — the unknown half", () => {
  it("does NOT renormalise a known parent up to a whole animal", () => {
    // The bug this whole file exists to prevent. A purebred Angus dam and a
    // bull nobody wrote down does NOT make an Angus calf.
    const index = indexOf([
      purebred("dam", "angus"),
      node({ id: "calf", damLotId: "dam" }),
    ]);
    const calf = resolveComposition("calf", index);
    expect(calf.denominator).toBe(2);
    expect(calf.parts).toEqual([{ breed: "angus", parts: 1 }]);
    expect(calf.unknownParts).toBe(1);
    expect(formatComposition(calf, slugLabel)).toBe("½ Angus · ½ unknown");
  });

  it("carries the unknown share down the generations", () => {
    const index = indexOf([
      purebred("granddam", "angus"),
      node({ id: "dam", damLotId: "granddam" }),
      node({ id: "calf", damLotId: "dam" }),
    ]);
    const calf = resolveComposition("calf", index);
    // A quarter Angus, and three quarters nobody can name.
    expect(formatComposition(calf, slugLabel)).toBe("¼ Angus · ¾ unknown");
  });

  it("is unknown when nothing is known, and says so", () => {
    const calf = resolveComposition("calf", indexOf([node({ id: "calf" })]));
    expect(calf.source).toBe("unknown");
    expect(calf.unknownParts).toBe(1);
    expect(calf.denominator).toBe(1);
    expect(calf.truncated).toBe(false);
  });

  it("reports a truncated walk separately from a genuine gap", () => {
    // The dam is named and simply absent from the loaded index. "Nobody knows"
    // and "we stopped looking" are different sentences.
    const calf = resolveComposition(
      "calf",
      indexOf([node({ id: "calf", damLotId: "dam" })]),
    );
    expect(calf.unknownParts).toBe(1);
    expect(calf.truncated).toBe(true);
  });
});

describe("resolveComposition — precedence and depth", () => {
  it("prefers what somebody stated over what the parents imply", () => {
    const index = indexOf([
      purebred("dam", "hereford"),
      purebred("sire", "hereford"),
      // Registered Angus, whatever the (wrong) parents on file say.
      node({ id: "calf", damLotId: "dam", sireLotId: "sire", stated: [
        { breed: "angus", parts: 1 },
      ] }),
    ]);
    const calf = resolveComposition("calf", index);
    expect(calf.source).toBe("stated");
    // One breed and nothing unknown reads as the breed, not as "all Angus".
    expect(formatComposition(calf, slugLabel)).toBe("Angus");
  });

  it("stays exact three generations down", () => {
    const index = indexOf([
      purebred("gg_dam", "angus"),
      purebred("gg_sire", "hereford"),
      node({ id: "g_dam", damLotId: "gg_dam", sireLotId: "gg_sire" }),
      purebred("g_sire", "simmental"),
      node({ id: "dam", damLotId: "g_dam", sireLotId: "g_sire" }),
      purebred("sire", "angus"),
      node({ id: "calf", damLotId: "dam", sireLotId: "sire" }),
    ]);
    const calf = resolveComposition("calf", index);
    expect(calf.denominator).toBe(8);
    // Ordered by share, largest first — not alphabetically.
    expect(shares(calf.parts, calf.denominator)).toEqual([
      "⅝ angus",
      "¼ simmental",
      "⅛ hereford",
    ]);
    // Nothing unknown anywhere in it, and the parts account for the whole.
    expect(calf.unknownParts).toBe(0);
    const total = calf.parts.reduce((sum, p) => sum + p.parts, 0);
    expect(total).toBe(calf.denominator);
    expect(calf.truncated).toBe(false);
  });

  it("terminates on a pedigree loop instead of hanging", () => {
    // Impossible through the write path. The fold must not depend on that.
    const index = indexOf([
      node({ id: "a", damLotId: "b", stated: [] }),
      node({ id: "b", damLotId: "a", stated: [] }),
    ]);
    const a = resolveComposition("a", index);
    expect(a.source).toBe("unknown");
    expect(a.truncated).toBe(true);
  });

  it("stops at the generation cap and reports it", () => {
    // A chain longer than the cap, purebred at the very top.
    const depth = MAX_GENERATIONS + 3;
    const nodes: PedigreeNode[] = [purebred(`gen${depth}`, "angus")];
    for (let i = depth - 1; i >= 0; i--) {
      nodes.push(node({ id: `gen${i}`, damLotId: `gen${i + 1}` }));
    }
    const resolved = resolveComposition("gen0", indexOf(nodes));
    expect(resolved.truncated).toBe(true);
  });
});

describe("isAncestor", () => {
  const index = indexOf([
    node({ id: "granddam" }),
    node({ id: "dam", damLotId: "granddam" }),
    node({ id: "calf", damLotId: "dam" }),
    node({ id: "unrelated" }),
  ]);

  it("finds a parent and a grandparent", () => {
    expect(isAncestor("dam", "calf", index)).toBe(true);
    expect(isAncestor("granddam", "calf", index)).toBe(true);
  });

  it("does not find a descendant, which is what makes it a loop guard", () => {
    // Setting granddam's dam to the calf is the write this refuses.
    expect(isAncestor("calf", "granddam", index)).toBe(false);
    expect(isAncestor("unrelated", "calf", index)).toBe(false);
  });

  it("terminates on a loop it was too late to prevent", () => {
    const looped = indexOf([
      node({ id: "a", damLotId: "b" }),
      node({ id: "b", damLotId: "a" }),
    ]);
    expect(isAncestor("c", "a", looped)).toBe(false);
  });
});

describe("ancestorTree", () => {
  it("stops at the depth asked for", () => {
    const index = indexOf([
      node({ id: "granddam" }),
      node({ id: "dam", damLotId: "granddam" }),
      node({ id: "calf", damLotId: "dam", sireLotId: "sire" }),
      node({ id: "sire" }),
    ]);
    const tree = ancestorTree("calf", index, 1);
    expect(tree.dam?.id).toBe("dam");
    expect(tree.sire?.id).toBe("sire");
    // One generation asked for, so the granddam is not walked to.
    expect(tree.dam?.dam).toBeNull();
  });

  it("gives a null child where nobody was recorded", () => {
    const tree = ancestorTree("calf", indexOf([node({ id: "calf" })]), 3);
    expect(tree.dam).toBeNull();
    expect(tree.sire).toBeNull();
  });
});

describe("formatShare", () => {
  it("uses the fraction a person would write", () => {
    expect(formatShare(1, 2)).toBe("½");
    expect(formatShare(3, 8)).toBe("⅜");
    expect(formatShare(2, 8)).toBe("¼");
  });

  it("falls back to plain fractions past the ones with a glyph", () => {
    expect(formatShare(1, 16)).toBe("1/16");
    expect(formatShare(5, 6)).toBe("5/6");
  });

  it("says `all` rather than 1/1", () => {
    expect(formatShare(1, 1)).toBe("all");
  });
});
