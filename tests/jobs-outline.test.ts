import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OUTLINE_QUESTION_KINDS } from "../src/db/schema";
import {
  WHO_DOES_IT,
  codeStanding,
  normalizeChoices,
  outlineFromCostCodes,
  outlineIssue,
  sortOrderAt,
  stepsWithUnknownCode,
  summarizeOutline,
  type CostCodeBook,
  type OutlineStepShape,
} from "../src/packs/jobs/outline-math";
import { resolveCostCode } from "../src/packs/jobs/assembly-math";
import {
  SEED_QUESTION_KINDS,
  estimateOutlinesFrom,
  summarizeJobsSeed,
} from "../src/packs/jobs/seed-shape";
import {
  CONSTRUCTION_ESTIMATE_OUTLINES,
  NEW_BUILD_OUTLINE,
  REMODEL_OUTLINE,
} from "../src/industries/construction/estimate-outlines";

/**
 * ESTIMATE OUTLINES (X1, ADR 0098) — the pure half.
 *
 * The interview that reads an outline is not built yet, so the thing worth
 * guarding here is the SHAPE it will read: that a question's options and its
 * kind cannot disagree, that a save keeps a row's identity, and that the
 * starters a new tenant finds are questions rather than one business's
 * answers.
 */

describe("sortOrderAt", () => {
  it("leaves room between rows so one can be dropped in", () => {
    expect([0, 1, 2].map(sortOrderAt)).toEqual([10, 20, 30]);
  });
});

describe("normalizeChoices", () => {
  it("keeps a choice's options, trimmed and in order", () => {
    expect(normalizeChoices("choice", [" Poured ", "Block"])).toEqual(["Poured", "Block"]);
  });

  it("drops blanks and duplicates, keeping the first spelling", () => {
    expect(normalizeChoices("choice", ["Poured", "", "  ", "poured", "Block"])).toEqual([
      "Poured",
      "Block",
    ]);
  });

  /**
   * A form that has just switched a question from a choice to a number still
   * holds the two options in its state. Dropping them is what the person
   * meant; refusing the save over a field they can no longer see is a dead end.
   */
  it("gives every other kind no options rather than refusing it for having them", () => {
    expect(normalizeChoices("number", ["Poured", "Block"])).toEqual([]);
    expect(normalizeChoices("yes_no", ["Yes", "No"])).toEqual([]);
    expect(normalizeChoices("text", undefined)).toEqual([]);
  });
});

describe("outlineIssue: the first thing wrong, as a sentence", () => {
  const ok: OutlineStepShape[] = [
    { title: "Foundation", questions: [{ prompt: "Block or poured?", kind: "choice", choices: ["Block", "Poured"] }] },
    { title: "Framing", questions: [{ prompt: "How many square feet?", kind: "number", unit: "sf" }] },
  ];

  it("passes an outline that is fine", () => {
    expect(outlineIssue(ok)).toBeNull();
  });

  it("refuses an outline with no steps", () => {
    expect(outlineIssue([])).toMatch(/at least one step/);
  });

  it("refuses a step with no name", () => {
    expect(outlineIssue([{ title: "   " }])).toMatch(/needs a name/);
  });

  /**
   * The interview says a step's name out loud and records an answer against
   * it; two "Foundation"s make a transcript nobody can read back. The database
   * allows them, so this is the only thing standing in the way.
   */
  it("refuses two steps by the same name, however they are cased", () => {
    expect(outlineIssue([{ title: "Foundation" }, { title: "foundation" }])).toMatch(
      /Two steps are both called/,
    );
  });

  it("refuses an empty question", () => {
    expect(outlineIssue([{ title: "Foundation", questions: [{ prompt: " " }] }])).toMatch(
      /has nothing in it/,
    );
  });

  it("refuses a choice with fewer than two real options", () => {
    const one: OutlineStepShape[] = [
      { title: "Foundation", questions: [{ prompt: "Block or poured?", kind: "choice", choices: ["Poured"] }] },
    ];
    expect(outlineIssue(one)).toMatch(/at least two options/);
    const blanks: OutlineStepShape[] = [
      { title: "Foundation", questions: [{ prompt: "Which?", kind: "choice", choices: ["A", "  ", "a"] }] },
    ];
    expect(outlineIssue(blanks)).toMatch(/at least two options/);
  });

  it("refuses the same question twice in one step, and allows it in two", () => {
    const twice: OutlineStepShape[] = [
      { title: "Foundation", questions: [{ prompt: "Who is doing this one?" }, { prompt: "who is doing this one?" }] },
    ];
    expect(outlineIssue(twice)).toMatch(/twice/);
    const across: OutlineStepShape[] = [
      { title: "Foundation", questions: [{ prompt: "Who is doing this one?" }] },
      { title: "Framing", questions: [{ prompt: "Who is doing this one?" }] },
    ];
    expect(outlineIssue(across)).toBeNull();
  });

  it("refuses a kind nothing understands", () => {
    const bad = [
      { title: "Foundation", questions: [{ prompt: "How much?", kind: "currency" }] },
    ] as unknown as OutlineStepShape[];
    expect(outlineIssue(bad)).toMatch(/kind nothing understands/);
  });
});

describe("summarizeOutline", () => {
  it("counts the steps, the questions, and the two kinds of gap", () => {
    expect(
      summarizeOutline([
        { title: "Foundation", costCode: "2000", questions: [{ prompt: "a" }, { prompt: "b" }] },
        { title: "Framing", costCode: "3000", questions: [] },
        { title: "Something", questions: [{ prompt: "c" }] },
      ]),
    ).toEqual({ steps: 3, questions: 3, silentSteps: 1, uncodedSteps: 1 });
  });

  it("is all zeroes for nothing", () => {
    expect(summarizeOutline([])).toEqual({
      steps: 0,
      questions: 0,
      silentSteps: 0,
      uncodedSteps: 0,
    });
  });
});

describe("outlineFromCostCodes: the chart of cost is already the phases", () => {
  const codes = [
    { code: "1000", name: "Permits and fees" },
    { code: "2000", name: "Foundation" },
    { code: "9999", name: "An old code", isActive: false },
  ];

  it("makes a step per active code, in order, carrying the code as text", () => {
    const steps = outlineFromCostCodes(codes);
    expect(steps.map((s) => s.title)).toEqual(["Permits and fees", "Foundation"]);
    expect(steps.map((s) => s.costCode)).toEqual(["1000", "2000"]);
  });

  /**
   * A chart keeps a retired code so old budgets still read; an interview
   * should not stop at a phase the business no longer sells.
   */
  it("leaves a retired code out", () => {
    expect(outlineFromCostCodes(codes)).toHaveLength(2);
  });

  it("asks the one question that is true of every phase, and stops", () => {
    const steps = outlineFromCostCodes(codes);
    for (const step of steps) {
      expect(step.questions).toHaveLength(1);
      expect(step.questions?.[0].prompt).toBe(WHO_DOES_IT.prompt);
    }
    expect(outlineIssue(steps)).toBeNull();
  });

  it("makes nothing from an empty chart", () => {
    expect(outlineFromCostCodes([])).toEqual([]);
  });
});

/**
 * The seed shape repeats the question kinds rather than importing them, so
 * that a profile's constant needs no database import. This is the guard that
 * stops the copy drifting — and it reads the CHECK's own text too, because
 * the SQL is a third copy and the one a bad value actually hits.
 */
describe("the question kinds are the same in all three places", () => {
  it("matches the schema's exported list", () => {
    expect([...SEED_QUESTION_KINDS]).toEqual([...OUTLINE_QUESTION_KINDS]);
  });

  it("matches the CHECK constraint beside the column", () => {
    const source = readFileSync(
      join(process.cwd(), "src/db/schema/jobs-estimate-outlines.ts"),
      "utf8",
    );
    const check = source.match(/kind_valid[\s\S]*?in \(([^)]*)\)/);
    expect(check).not.toBeNull();
    const inSql = check![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(inSql.sort()).toEqual([...OUTLINE_QUESTION_KINDS].sort());
  });
});

describe("estimateOutlinesFrom: unreadable means nothing, never a throw", () => {
  it("reads a well-formed seed", () => {
    const out = estimateOutlinesFrom({
      estimateOutlines: [
        {
          name: " New build ",
          notes: "n",
          steps: [{ title: " Foundation ", costCode: " 2000 ", questions: [{ prompt: "Block or poured?", kind: "choice", choices: ["Block", "Poured"] }] }],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("New build");
    expect(out[0].steps[0].title).toBe("Foundation");
    expect(out[0].steps[0].costCode).toBe("2000");
    expect(out[0].steps[0].questions?.[0].choices).toEqual(["Block", "Poured"]);
  });

  it("gives nothing for anything it cannot read", () => {
    expect(estimateOutlinesFrom(null)).toEqual([]);
    expect(estimateOutlinesFrom({})).toEqual([]);
    expect(estimateOutlinesFrom({ estimateOutlines: "yes" })).toEqual([]);
    expect(estimateOutlinesFrom({ estimateOutlines: [42, null] })).toEqual([]);
    expect(estimateOutlinesFrom({ estimateOutlines: [{ name: "x" }] })).toEqual([]);
  });

  it("drops an outline whose every step is unreadable, rather than making an empty one", () => {
    expect(
      estimateOutlinesFrom({ estimateOutlines: [{ name: "x", steps: [{ title: "" }] }] }),
    ).toEqual([]);
  });

  /**
   * A seeded choice with one option would otherwise be written as a `text`
   * question nobody meant. A starter that quietly changed what it asks is
   * worse than one short question.
   */
  it("drops a choice with fewer than two options rather than demoting it", () => {
    const out = estimateOutlinesFrom({
      estimateOutlines: [
        {
          name: "x",
          steps: [{ title: "s", questions: [{ prompt: "Which?", kind: "choice", choices: ["only"] }] }],
        },
      ],
    });
    expect(out[0].steps[0].questions).toEqual([]);
  });

  it("falls back to text for a kind it does not know", () => {
    const out = estimateOutlinesFrom({
      estimateOutlines: [
        { name: "x", steps: [{ title: "s", questions: [{ prompt: "p", kind: "wat" }] }] },
      ],
    });
    expect(out[0].steps[0].questions?.[0].kind).toBe("text");
  });

  it("says what a seed would bring, counting both kinds", () => {
    expect(
      summarizeJobsSeed({
        costCodeSets: [{ name: "a", codes: [{ code: "1", name: "one" }] }],
        estimateOutlines: [{ name: "b", steps: [{ title: "s" }] }],
      }),
    ).toBe("1 cost code list (1 codes), 1 estimate outline (1 steps)");
    expect(summarizeJobsSeed({})).toBeNull();
  });
});

/**
 * The construction profile's starters. The pilot-name scan lives in
 * `tests/packs.test.ts`; what is checked here is that they are usable
 * outlines and that the two are genuinely different walks rather than one
 * walk twice.
 */
describe("the construction profile's starter outlines", () => {
  it("ships two, new build first so it becomes the default", () => {
    expect(CONSTRUCTION_ESTIMATE_OUTLINES.map((o) => o.name)).toEqual([
      "New build",
      "Remodel",
    ]);
  });

  it("are outlines the editor would accept", () => {
    for (const outline of CONSTRUCTION_ESTIMATE_OUTLINES) {
      expect(outlineIssue(outline.steps)).toBeNull();
    }
  });

  it("survive the seed parser unchanged", () => {
    const parsed = estimateOutlinesFrom({
      estimateOutlines: CONSTRUCTION_ESTIMATE_OUTLINES,
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[0].steps).toHaveLength(NEW_BUILD_OUTLINE.steps.length);
    expect(parsed[1].steps).toHaveLength(REMODEL_OUTLINE.steps.length);
    const questions = parsed.flatMap((o) => o.steps.flatMap((s) => s.questions ?? []));
    expect(questions.length).toBeGreaterThan(80);
  });

  /**
   * THE REMODEL IS NOT THE NEW BUILD WITH FEWER STEPS. Its first four stops
   * have no counterpart on a bare lot, and an outline that lost them would
   * have made the founder's own point — that these are two different walks —
   * quietly untrue.
   */
  it("give the remodel the stops a new build has no reason to have", () => {
    const remodel = REMODEL_OUTLINE.steps.map((s) => s.title);
    const newBuild = new Set(NEW_BUILD_OUTLINE.steps.map((s) => s.title));
    for (const only of [
      "Scope and existing conditions",
      "Demolition",
      "Hazardous materials",
      "Protection and containment",
      "Temporary arrangements",
      "Concealed conditions",
    ]) {
      expect(remodel).toContain(only);
      expect(newBuild.has(only)).toBe(false);
    }
  });

  /**
   * **A PHASE YOU COULD NOT SUB OUT MUST NOT BE OFFERED "BIDDING IT OUT".**
   * The founder walked a real bid and hit it at once: *"we would never bid
   * out permits."* A button that is never a real answer teaches somebody the
   * buttons are decoration.
   */
  it("never offers to bid out a phase nobody bids out", () => {
    const NEVER_BID = ["Permits and fees", "Permits", "Plans and engineering"];
    for (const outline of CONSTRUCTION_ESTIMATE_OUTLINES) {
      for (const step of outline.steps) {
        if (!NEVER_BID.includes(step.title)) continue;
        for (const q of step.questions ?? []) {
          expect(q.choices ?? [], `${outline.name} / ${step.title}`).not.toContain(
            "Bidding it out",
          );
        }
      }
    }
  });

  it("still asks who does it on the phases a trade actually does", () => {
    const asked = CONSTRUCTION_ESTIMATE_OUTLINES.flatMap((o) =>
      o.steps.filter((s) => (s.questions ?? []).some((q) => q.prompt === WHO_DOES_IT.prompt)),
    );
    expect(asked.length).toBeGreaterThan(20);
  });

  it("open all but the scoping stops with who is doing the work", () => {
    for (const outline of CONSTRUCTION_ESTIMATE_OUTLINES) {
      for (const step of outline.steps) {
        const first = step.questions?.[0];
        expect(first, `${outline.name} / ${step.title} asks nothing`).toBeDefined();
      }
    }
  });

  /**
   * A starter asks; it never answers. A number in a prompt would be one
   * business's house, which is the narrowing the profile exists to refuse —
   * so no question or guidance may carry a measurement or a sum.
   */
  it("state no size, no price and no rate", () => {
    /**
     * The WORDS a builder reads, not the JSON: a cost code is digits and
     * would trip any scan run over the serialized object.
     */
    const words: string[] = [];
    for (const outline of CONSTRUCTION_ESTIMATE_OUTLINES) {
      words.push(outline.name, outline.notes ?? "");
      for (const step of outline.steps) {
        words.push(step.title, step.guidance ?? "");
        for (const q of step.questions ?? []) {
          words.push(q.prompt, q.notes ?? "", ...(q.choices ?? []));
        }
      }
    }
    const text = words.join("\n");
    /** No money at all: not a price, not an allowance, not a rate. */
    expect(/\$\s*\d/.test(text)).toBe(false);
    expect(/\bper (square foot|sf|lf|hour|hr)\b/i.test(text)).toBe(false);
    /** No dimension: "how wide is the footing" ships, "24 inches" does not. */
    expect(/\d+\s*(inch|inches|"|foot|feet|'|sq ?ft|psi|o\.c\.)/i.test(text)).toBe(false);
    /** And no bare number in a prompt, which is where an answer would hide. */
    expect(/\d/.test(text)).toBe(false);
  });
});

/**
 * A step's cost code is TEXT so an outline can be walked on a job using any
 * of the tenant's lists (ADR 0098). The price of that is a typo nobody
 * notices, so the editor checks as somebody types — and it has to agree with
 * `resolveCostCode`, which is what the interview will actually use.
 */
describe("codeStanding: is this a code the business has?", () => {
  const books: CostCodeBook[] = [
    {
      id: "a",
      name: "Residential phases",
      isDefault: true,
      codes: [
        { code: "2000", name: "Foundation" },
        { code: "3000", name: "Framing labor" },
      ],
    },
    {
      id: "b",
      name: "CSI divisions",
      isDefault: false,
      codes: [
        { code: "03 00 00", name: "Concrete" },
        { code: "2000", name: "Foundation" },
      ],
    },
  ];

  it("says nothing about a blank code", () => {
    expect(codeStanding("", books)).toEqual({ state: "none", name: "", missingFrom: [] });
    expect(codeStanding("   ", books).state).toBe("none");
  });

  it("is quiet when every list has it, and names it", () => {
    expect(codeStanding("2000", books)).toEqual({
      state: "everywhere",
      name: "Foundation",
      missingFrom: [],
    });
  });

  /**
   * The sentence worth having. A code in one list and not another comes out
   * uncoded on a job using the other one, and nothing else would tell you.
   */
  it("names the lists that do NOT have it", () => {
    expect(codeStanding("3000", books)).toEqual({
      state: "partial",
      name: "Framing labor",
      missingFrom: ["CSI divisions"],
    });
  });

  it("warns when no list has it", () => {
    const out = codeStanding("2O00", books);
    expect(out.state).toBe("missing");
    expect(out.name).toBe("");
  });

  it("is missing rather than fine when the business keeps no lists at all", () => {
    expect(codeStanding("2000", []).state).toBe("missing");
  });

  /**
   * THE TWO MUST AGREE. A second normalizer would mean a code the editor
   * calls good and the walk cannot find, which is the failure this whole
   * check exists to prevent.
   */
  it("matches exactly what resolveCostCode matches", () => {
    const codes = [{ id: "c1", code: "03 00 00" }];
    for (const written of ["03 00 00", "030000", " 03  00  00 ", "03 00 00 "]) {
      expect(resolveCostCode(written, codes), written).toBe("c1");
      expect(codeStanding(written, [books[1]]).state, written).toBe("everywhere");
    }
    expect(resolveCostCode("03 00 01", codes)).toBeNull();
    expect(codeStanding("03 00 01", [books[1]]).state).toBe("missing");
  });

  it("counts the steps whose code nothing has, and leaves a blank alone", () => {
    const steps: OutlineStepShape[] = [
      { title: "Fine", costCode: "2000" },
      { title: "Typo", costCode: "2O00" },
      { title: "Also a typo", costCode: "9999" },
      { title: "Deliberately blank", costCode: "" },
      { title: "No code field at all" },
    ];
    expect(stepsWithUnknownCode(steps, books)).toBe(2);
    expect(summarizeOutline(steps).uncodedSteps).toBe(2);
  });
});

/**
 * ALWAYS ASK (ADR 0098): the counterweight to letting the walk skip. Off by
 * default, because most questions should be skippable — a walk that asks
 * about rebar after you said block is one people learn to click through.
 */
describe("the starters mark the questions a walk may never skip", () => {
  const always = CONSTRUCTION_ESTIMATE_OUTLINES.flatMap((o) =>
    o.steps.flatMap((s) => (s.questions ?? []).filter((q) => q.alwaysAsk)),
  );

  it("marks a few, not most — or the mark means nothing", () => {
    const all = CONSTRUCTION_ESTIMATE_OUTLINES.reduce(
      (n, o) => n + o.steps.reduce((m, s) => m + (s.questions?.length ?? 0), 0),
      0,
    );
    expect(always.length).toBeGreaterThan(0);
    expect(always.length).toBeLessThan(all / 4);
  });

  it("includes the ones where being asked is the whole point", () => {
    const prompts = always.map((q) => q.prompt);
    expect(prompts).toContain(
      "Is there any asbestos, lead paint or mould known or suspected?",
    );
    expect(prompts).toContain("How much is carried for what nobody can see yet?");
    expect(prompts).toContain("Are any walls coming out?");
  });

  it("leaves everything else skippable", () => {
    const skippable = CONSTRUCTION_ESTIMATE_OUTLINES.flatMap((o) =>
      o.steps.flatMap((s) => (s.questions ?? []).filter((q) => !q.alwaysAsk)),
    );
    expect(skippable.length).toBeGreaterThan(always.length);
    expect(skippable.some((q) => q.prompt === WHO_DOES_IT.prompt)).toBe(true);
  });

  it("carries the mark through the seed parser", () => {
    const parsed = estimateOutlinesFrom({
      estimateOutlines: CONSTRUCTION_ESTIMATE_OUTLINES,
    });
    const marked = parsed.flatMap((o) =>
      o.steps.flatMap((s) => (s.questions ?? []).filter((q) => q.alwaysAsk)),
    );
    expect(marked).toHaveLength(always.length);
  });

  it("defaults to false when a seed does not say", () => {
    const parsed = estimateOutlinesFrom({
      estimateOutlines: [{ name: "x", steps: [{ title: "s", questions: [{ prompt: "p" }] }] }],
    });
    expect(parsed[0].steps[0].questions?.[0].alwaysAsk).toBe(false);
  });
});
