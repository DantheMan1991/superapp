import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import type { Tenant } from "../src/db/schema";
import type { TenantContext } from "../src/lib/auth";
import { FitnessError } from "../src/modules/fitness/core/errors";
import { normalizeDraft } from "../src/modules/fitness/core/draft";
import type { ProgramInput } from "../src/modules/fitness/core/program";
import {
  deleteProgram,
  listPrograms,
  loadProgram,
  programToInput,
  saveProgram,
  sessionPlan,
  type LoadedProgram,
} from "../src/modules/fitness/program-ops";
import {
  INTERRUPTED,
  discardImport,
  draftProgram,
  getImport,
  importDraft,
  listOpenImports,
  markImportSaved,
  startImport,
} from "../src/modules/fitness/import-ops";
import { DraftModelError } from "../src/modules/fitness/draft-model";
import { ensurePersonalTools } from "../src/lib/personal-space";
import { randomUUID } from "node:crypto";
import {
  beginSession,
  finishExercise,
  finishSession,
  recordSet,
  type SessionDoc,
} from "../src/modules/fitness/core/session";
import { dayProgress, shiftDay, toDayItem } from "../src/modules/fitness/core/day";
import {
  lastSession,
  latestFollowed,
  programSessions,
  recentSessions,
  saveSession,
  sessionCount,
} from "../src/modules/fitness/session-ops";

/**
 * Workouts against a real database (docs/modules/fitness.md, F1): a program
 * saved from the editor and edited by id, a draft made from a PDF's pages with
 * the Claude call replaced by a function, and the preview rule that switches
 * Workouts on in a superadmin's own space.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `fitness-ops-${process.pid}`;

let tenant: Tenant;
let ctx: TenantContext;

/** A program the way the editor sends a new one. */
function aProgram(): ProgramInput {
  return {
    name: "Test program",
    author: "Somebody",
    notes: "Three times a week.",
    sessionsPerWeekMin: 3,
    sessionsPerWeekMax: 4,
    effortMin: 3,
    effortMax: 5,
    breathOutS: 5,
    breathInS: 4,
    phases: [
      {
        phaseId: null,
        name: "Weeks 1–2",
        minDoneDays: 14,
        notes: "",
        items: [
          item("Hip lift", "breaths", 2, 8),
          item("Block squeeze", "breaths", 2, 5),
        ],
      },
      {
        phaseId: null,
        name: "Weeks 3–4",
        minDoneDays: 14,
        notes: "",
        items: [item("Wall stack", "breaths", 2, 8)],
      },
    ],
  };
}

function item(name: string, unit: "reps" | "breaths", sets: number, target: number) {
  return {
    itemId: null,
    exerciseId: null,
    name,
    purpose: `${name}, for the test`,
    cues: ["Relaxed"],
    unit,
    videos: [{ id: "fBViIToMhKA", startS: null, endS: null, label: null, embeddable: true }],
    setsMin: sets,
    setsMax: null,
    targetMin: target,
    targetMax: null,
    perSide: false,
    optional: false,
    notes: "",
  };
}

function inTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(tenant.id, fn, { role: "owner" });
}

d("workouts: programs and imports", () => {
  beforeAll(async () => {
    tenant = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Personal",
          slug: `${STAMP}-slug`,
          kind: "personal",
          personalOwnerClerkUserId: `user_fitnessops${process.pid}`,
        })
        .returning();
      return row;
    });
    ctx = { tenant, userId: `user_fitnessops${process.pid}`, role: "owner", support: null };
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id)));
  });

  describe("saving a program", () => {
    let programId: string;
    let version: number;

    it("saves a new program with its phases, exercises and prescriptions, in order", async () => {
      const saved = await inTenant((tx) =>
        saveProgram(tx, tenant.id, aProgram(), { programId: null, source: "own" }),
      );
      programId = saved.programId;
      version = saved.version;
      const loaded = await inTenant((tx) => loadProgram(tx, tenant.id, programId));
      expect(loaded?.phases.map((p) => p.name)).toEqual(["Weeks 1–2", "Weeks 3–4"]);
      expect(loaded?.phases[0].items.map((i) => i.exercise.name)).toEqual(["Hip lift", "Block squeeze"]);
      expect(loaded?.phases[0].items[0]).toMatchObject({ setsMin: 2, targetMin: 8 });
      expect(loaded?.phases[0].items[0].exercise.videos[0]).toEqual({
        provider: "youtube",
        id: "fBViIToMhKA",
        startS: null,
        endS: null,
        label: null,
        embeddable: true,
      });
      expect(loaded?.source).toBe("own");
    });

    it("round-trips through the editor's shape unchanged", async () => {
      const loaded = await inTenant((tx) => loadProgram(tx, tenant.id, programId));
      const input = programToInput(loaded!);
      expect(input.phases[0].items[0].itemId).toBe(loaded!.phases[0].items[0].id);
      expect({ ...input, phases: input.phases.map((p) => ({ ...p, phaseId: null, items: p.items.map((i) => ({ ...i, itemId: null, exerciseId: null })) })) }).toEqual(aProgram());
    });

    it("an edit keeps every row's id, moves what moved, and drops only what the edit dropped", async () => {
      const loaded = await inTenant((tx) => loadProgram(tx, tenant.id, programId));
      const input = programToInput(loaded!);
      const [first, second] = input.phases;
      const [hipLift, blockSqueeze] = first.items;
      // Move the block squeeze into phase 2, drop the wall stack, add one new.
      const edited: ProgramInput = {
        ...input,
        name: "Test program, edited",
        phases: [
          { ...first, items: [{ ...hipLift, targetMin: 10 }] },
          { ...second, items: [blockSqueeze, item("Calf raise", "reps", 3, 12)] },
        ],
      };
      const saved = await inTenant((tx) =>
        saveProgram(tx, tenant.id, edited, { programId, version }),
      );
      expect(saved.version).toBe(version + 1);
      version = saved.version;

      const after = await inTenant((tx) => loadProgram(tx, tenant.id, programId));
      expect(after?.name).toBe("Test program, edited");
      expect(after?.phases[0].items.map((i) => i.id)).toEqual([hipLift.itemId]);
      expect(after?.phases[0].items[0].targetMin).toBe(10);
      expect(after?.phases[1].items.map((i) => i.exercise.name)).toEqual(["Block squeeze", "Calf raise"]);
      // The moved item is the same row, pointing at the same exercise.
      expect(after?.phases[1].items[0].id).toBe(blockSqueeze.itemId);
      expect(after?.phases[1].items[0].exercise.id).toBe(blockSqueeze.exerciseId);

      // The wall stack's exercise went with its only use.
      const exercises = await inTenant((tx) =>
        tx.select({ name: schema.fitnessExercises.name }).from(schema.fitnessExercises)
          .where(and(eq(schema.fitnessExercises.tenantId, tenant.id), eq(schema.fitnessExercises.programId, programId))),
      );
      expect(exercises.map((e) => e.name).sort()).toEqual(["Block squeeze", "Calf raise", "Hip lift"]);
    });

    it("refuses an edit made against an older version — a second tab never overwrites the first", async () => {
      const loaded = await inTenant((tx) => loadProgram(tx, tenant.id, programId));
      await expect(
        inTenant((tx) => saveProgram(tx, tenant.id, programToInput(loaded!), { programId, version: version - 1 })),
      ).rejects.toMatchObject({ code: "STALE" });
    });

    it("refuses an id this program does not have, rather than inserting it as new", async () => {
      const loaded = await inTenant((tx) => loadProgram(tx, tenant.id, programId));
      const input = programToInput(loaded!);
      input.phases[0].items[0].itemId = "00000000-0000-4000-8000-000000000000";
      await expect(
        inTenant((tx) => saveProgram(tx, tenant.id, input, { programId, version })),
      ).rejects.toBeInstanceOf(FitnessError);
    });

    it("lists it with its counts, and deletes it with everything in it", async () => {
      const list = await inTenant((tx) => listPrograms(tx, tenant.id));
      expect(list.find((p) => p.id === programId)).toMatchObject({ phaseCount: 2, exerciseCount: 3 });
      await inTenant((tx) => deleteProgram(tx, tenant.id, programId));
      const gone = await inTenant((tx) =>
        tx.select().from(schema.fitnessPhases).where(eq(schema.fitnessPhases.programId, programId)),
      );
      expect(gone).toHaveLength(0);
      await expect(inTenant((tx) => deleteProgram(tx, tenant.id, programId))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("drafting from a PDF's pages", () => {
    const pages = [
      { n: 1, text: "Starter Mobility. ".repeat(20), links: [] },
      { n: 2, text: "Exercise 1: 90/90 hip lift, 2 x 8 breaths. ".repeat(5), links: ["https://youtu.be/fBViIToMhKA"] },
    ];
    const answer = {
      name: "Starter Mobility",
      author: "A. Coach",
      notes: "",
      sessionsPerWeekMin: 3,
      sessionsPerWeekMax: 4,
      effortMin: 3,
      effortMax: 5,
      phases: [
        {
          name: "Weeks 1–2",
          minDoneDays: 14,
          notes: "",
          items: [
            {
              name: "90/90 hip lift",
              purpose: "Pelvic control.",
              cues: ["Hamstrings only"],
              unit: "breaths",
              videos: [{ url: "https://youtu.be/fBViIToMhKA", label: null }],
              setsMin: 2,
              setsMax: null,
              targetMin: 8,
              targetMax: null,
              perSide: false,
              optional: false,
              notes: "",
            },
          ],
        },
      ],
    };
    const model = async () => answer;
    const videos = async () => ({ embeddable: true, title: null });

    it("drafts: the import goes drafting → draft, holding the normalized draft, with YouTube's answer", async () => {
      const { importId } = await draftProgram(
        ctx,
        { fileName: "program.pdf", pageCount: 2, pages },
        { model, videos },
      );
      const row = await inTenant((tx) => getImport(tx, tenant.id, importId));
      expect(row?.status).toBe("draft");
      expect(row?.linkCount).toBe(1);
      const draft = importDraft(row!);
      expect(draft).toEqual(
        (() => {
          const expected = normalizeDraft(answer);
          expected.phases[0].items[0].videos[0].embeddable = true;
          return expected;
        })(),
      );
      // The book's text is not stored anywhere on the row.
      expect(JSON.stringify(row)).not.toContain("Starter Mobility. Starter");

      // Saved as a program, the import records it and lets the draft go.
      const saved = await inTenant(async (tx) => {
        const result = await saveProgram(tx, tenant.id, draft!, { programId: null, source: "imported" });
        await markImportSaved(tx, tenant.id, importId, result.programId);
        return result;
      });
      const after = await inTenant((tx) => getImport(tx, tenant.id, importId));
      expect(after).toMatchObject({ status: "saved", programId: saved.programId, draft: null });
      // A second save from the same draft is stale.
      await expect(
        inTenant((tx) => markImportSaved(tx, tenant.id, importId, saved.programId)),
      ).rejects.toMatchObject({ code: "STALE" });
    });

    it("a failed draft is recorded with a sentence the person can act on, and can be discarded", async () => {
      await expect(
        draftProgram(
          ctx,
          { fileName: "refused.pdf", pageCount: 2, pages },
          {
            model: async () => {
              throw new DraftModelError("REFUSED");
            },
            videos,
          },
        ),
      ).rejects.toMatchObject({ code: "DRAFT_FAILED" });
      const open = await inTenant((tx) => listOpenImports(tx, tenant.id));
      const failed = open.find((row) => row.fileName === "refused.pdf");
      expect(failed?.status).toBe("failed");
      expect(failed?.error).toBe("Claude would not draft this file. Build the program by hand instead.");
      await inTenant((tx) => discardImport(tx, tenant.id, failed!.id));
      const after = await inTenant((tx) => getImport(tx, tenant.id, failed!.id));
      expect(after?.status).toBe("discarded");
    });

    it("refuses a PDF with no words, and one too long to be a program, before any row is made", async () => {
      const before = (await inTenant((tx) => listOpenImports(tx, tenant.id))).length;
      await expect(
        draftProgram(ctx, { fileName: "scan.pdf", pageCount: 1, pages: [{ n: 1, text: "   ", links: [] }] }, { model, videos }),
      ).rejects.toMatchObject({ code: "NO_TEXT" });
      const long = Array.from({ length: 10 }, (_, i) => ({ n: i + 1, text: "x".repeat(35_000), links: [] }));
      await expect(
        draftProgram(ctx, { fileName: "book.pdf", pageCount: 10, pages: long }, { model, videos }),
      ).rejects.toMatchObject({ code: "TOO_LONG" });
      expect((await inTenant((tx) => listOpenImports(tx, tenant.id))).length).toBe(before);
    });

    it("drafts one at a time: a second press while the first is reading is BUSY, not a second bill", async () => {
      let release!: () => void;
      const slow = () =>
        new Promise<unknown>((resolve) => {
          release = () => resolve(answer);
        });
      const first = draftProgram(ctx, { fileName: "first.pdf", pageCount: 2, pages }, { model: slow, videos });
      // Wait until the first import's row exists.
      for (let i = 0; i < 50; i++) {
        const open = await inTenant((tx) => listOpenImports(tx, tenant.id));
        if (open.some((row) => row.fileName === "first.pdf")) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await expect(
        draftProgram(ctx, { fileName: "second.pdf", pageCount: 2, pages }, { model, videos }),
      ).rejects.toMatchObject({ code: "BUSY" });
      release();
      await first;
    });

    it("a draft that never finished reads as interrupted once its window has passed, and can be discarded", async () => {
      const importId = await inTenant((tx) =>
        startImport(tx, tenant.id, { fileName: "stuck.pdf", pageCount: 3, linkCount: 0, clerkUserId: ctx.userId }),
      );
      // Inside the window it is drafting, it holds the door, and it cannot be thrown away.
      expect((await inTenant((tx) => getImport(tx, tenant.id, importId)))?.status).toBe("drafting");
      await expect(inTenant((tx) => discardImport(tx, tenant.id, importId))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      // Whatever was drafting it died with it. Six minutes on, nothing will finish it.
      await inTenant((tx) =>
        tx
          .update(schema.fitnessImports)
          .set({ createdAt: new Date(Date.now() - 6 * 60 * 1000) })
          .where(eq(schema.fitnessImports.id, importId)),
      );
      const open = await inTenant((tx) => listOpenImports(tx, tenant.id));
      expect(open.find((row) => row.id === importId)).toMatchObject({ status: "failed", error: INTERRUPTED });
      expect((await inTenant((tx) => getImport(tx, tenant.id, importId)))?.status).toBe("failed");
      await inTenant((tx) => discardImport(tx, tenant.id, importId));
      // Read straight from the table: `getImport` would settle a row still drafting.
      const [row] = await inTenant((tx) =>
        tx
          .select({ status: schema.fitnessImports.status })
          .from(schema.fitnessImports)
          .where(eq(schema.fitnessImports.id, importId)),
      );
      expect(row?.status).toBe("discarded");
    });
  });

  describe("the preview a superadmin's space gets", () => {
    it("switches Workouts on while it is coming soon only with preview, and never twice", async () => {
      const Rollback = new Error("rollback");
      await withSystem(async (tx) => {
        const [fitness] = await tx
          .select({ status: schema.modules.status })
          .from(schema.modules)
          .where(eq(schema.modules.id, "fitness"));
        // On a database the seed has not reached, there is nothing to switch on.
        if (!fitness) throw Rollback;
        const fitnessRow = () =>
          tx
            .select({ enabled: schema.tenantModules.enabled })
            .from(schema.tenantModules)
            .where(and(eq(schema.tenantModules.tenantId, tenant.id), eq(schema.tenantModules.moduleId, "fitness")));
        await tx
          .delete(schema.tenantModules)
          .where(and(eq(schema.tenantModules.tenantId, tenant.id), eq(schema.tenantModules.moduleId, "fitness")));
        await ensurePersonalTools(tx, tenant.id);
        // Coming soon: a plain space does not get it; available: every space does.
        expect(await fitnessRow()).toEqual(fitness.status === "coming_soon" ? [] : [{ enabled: true }]);
        await ensurePersonalTools(tx, tenant.id, { preview: true });
        expect(await fitnessRow()).toEqual([{ enabled: true }]);
        // Never a second row, and never switched back on once off.
        await tx
          .update(schema.tenantModules)
          .set({ enabled: false })
          .where(and(eq(schema.tenantModules.tenantId, tenant.id), eq(schema.tenantModules.moduleId, "fitness")));
        await ensurePersonalTools(tx, tenant.id, { preview: true });
        expect(await fitnessRow()).toEqual([{ enabled: false }]);
        throw Rollback;
      }).catch((err) => {
        if (err !== Rollback) throw err;
      });
    });
  });

  describe("workout sessions (F2a)", () => {
    async function freshProgram(name: string): Promise<LoadedProgram> {
      const saved = await inTenant((tx) =>
        saveProgram(tx, tenant.id, { ...aProgram(), name }, { programId: null, source: "own" }),
      );
      const program = await inTenant((tx) => loadProgram(tx, tenant.id, saved.programId));
      return program!;
    }

    function withSet(program: LoadedProgram, doc: SessionDoc, count: number): SessionDoc {
      return recordSet(sessionPlan(program, 0), doc, {
        itemIndex: 0,
        count,
        setId: randomUUID(),
        exerciseId: randomUUID(),
        now: new Date(),
      });
    }

    async function setsOf(sessionId: string) {
      return inTenant((tx) =>
        tx
          .select({ id: schema.fitnessSets.id, count: schema.fitnessSets.count })
          .from(schema.fitnessSets)
          .innerJoin(
            schema.fitnessSessionExercises,
            eq(schema.fitnessSessionExercises.id, schema.fitnessSets.sessionExerciseId),
          )
          .where(eq(schema.fitnessSessionExercises.sessionId, sessionId)),
      );
    }

    it("keeps a session sent whole, again and again, and never lets an older copy undo a newer one", async () => {
      const program = await freshProgram("Sessions, sent whole");
      let doc = beginSession(sessionPlan(program, 0), { id: randomUUID(), now: new Date(), feelBefore: 4 });
      doc = withSet(program, doc, 8);
      expect(await inTenant((tx) => saveSession(tx, tenant.id, doc))).toEqual({ revision: 2, stale: false });
      // The same document again (a phone that did not hear back): acknowledged, nothing new.
      expect(await inTenant((tx) => saveSession(tx, tenant.id, doc))).toEqual({ revision: 2, stale: true });

      const older = doc;
      doc = withSet(program, doc, 7);
      await inTenant((tx) => saveSession(tx, tenant.id, doc));
      // The older copy, arriving late, is ignored.
      expect(await inTenant((tx) => saveSession(tx, tenant.id, older))).toEqual({ revision: 3, stale: true });
      expect((await setsOf(doc.id)).map((s) => s.count).sort()).toEqual([7, 8]);

      // Following the program: one enrollment, made by the first session.
      const enrollments = await inTenant((tx) =>
        tx.select().from(schema.fitnessEnrollments).where(eq(schema.fitnessEnrollments.programId, program.id)),
      );
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0]).toMatchObject({ startedOn: doc.localDay, endedAt: null, side: null });

      // A set taken back: the next revision without it deletes its row.
      const takenBack: SessionDoc = {
        ...doc,
        revision: doc.revision + 1,
        exercises: doc.exercises.map((exercise) => ({ ...exercise, sets: exercise.sets.slice(0, 1) })),
      };
      await inTenant((tx) => saveSession(tx, tenant.id, takenBack));
      expect(await setsOf(doc.id)).toHaveLength(1);

      const last = await inTenant((tx) => lastSession(tx, tenant.id, program.id));
      expect(last).toMatchObject({ id: doc.id, sets: 1, feelBefore: 4, finishedAt: null, localDay: doc.localDay });
      expect(last?.phaseName).toBe(program.phases[0].name);
    });

    it("refuses a session id another program's session holds, and a day ahead of any today", async () => {
      const a = await freshProgram("Sessions, program A");
      const b = await freshProgram("Sessions, program B");
      const doc = beginSession(sessionPlan(a, 0), { id: randomUUID(), now: new Date(), feelBefore: null });
      await inTenant((tx) => saveSession(tx, tenant.id, doc));
      await expect(
        inTenant((tx) => saveSession(tx, tenant.id, { ...doc, programId: b.id, revision: 5 })),
      ).rejects.toMatchObject({ code: "INVALID" });
      const ahead = { ...beginSession(sessionPlan(a, 0), { id: randomUUID(), now: new Date(), feelBefore: null }), localDay: "2099-01-01" };
      await expect(inTenant((tx) => saveSession(tx, tenant.id, ahead))).rejects.toMatchObject({ code: "INVALID" });
    });

    it("keeps a log when an edit removes what it logged, and deletes it with the program", async () => {
      const program = await freshProgram("Sessions, edited");
      let doc = beginSession(sessionPlan(program, 0), { id: randomUUID(), now: new Date(), feelBefore: null });
      doc = withSet(program, doc, 8);
      await inTenant((tx) => saveSession(tx, tenant.id, doc));

      // The exercise it logged is edited away: the log stays, its link nulled
      // (the column-list SET NULL; a bare one could not run), its name kept.
      const input = programToInput(program);
      input.phases[0].items = input.phases[0].items.slice(1);
      await inTenant((tx) => saveProgram(tx, tenant.id, input, { programId: program.id, version: program.version }));
      const [logged] = await inTenant((tx) =>
        tx
          .select()
          .from(schema.fitnessSessionExercises)
          .where(eq(schema.fitnessSessionExercises.sessionId, doc.id)),
      );
      expect(logged).toMatchObject({ itemId: null, exerciseId: null, name: "Hip lift", unit: "breaths" });

      // The phone sends it again, still naming the item that is gone: stored as null, not refused.
      await inTenant((tx) => saveSession(tx, tenant.id, { ...doc, revision: doc.revision + 1 }));
      expect(await setsOf(doc.id)).toHaveLength(1);

      // Its whole phase edited away: the session keeps the phase's name.
      const edited = await inTenant((tx) => loadProgram(tx, tenant.id, program.id));
      const without = programToInput(edited!);
      without.phases = without.phases.slice(1);
      await inTenant((tx) => saveProgram(tx, tenant.id, without, { programId: program.id, version: edited!.version }));
      const [session] = await inTenant((tx) =>
        tx.select().from(schema.fitnessSessions).where(eq(schema.fitnessSessions.id, doc.id)),
      );
      expect(session).toMatchObject({ phaseId: null, phaseName: program.phases[0].name });

      // Deleting the program takes its workouts with it, and the dialog can say how many.
      expect(await inTenant((tx) => sessionCount(tx, tenant.id, program.id))).toBe(1);
      await inTenant((tx) => deleteProgram(tx, tenant.id, program.id));
      expect(
        await inTenant((tx) => tx.select().from(schema.fitnessSessions).where(eq(schema.fitnessSessions.id, doc.id))),
      ).toEqual([]);
      expect(await setsOf(doc.id)).toEqual([]);
    });
  });

  describe("split days (F2c)", () => {
    it("gives a program's sessions on the days asked for, as a day adds them up: full sets per item", async () => {
      const base = aProgram();
      const saved = await inTenant((tx) =>
        saveProgram(
          tx,
          tenant.id,
          {
            ...base,
            name: "Split day",
            phases: [
              {
                ...base.phases[0],
                items: [{ ...item("Side reach", "breaths", 2, 5), perSide: true }, item("Hip lift", "breaths", 2, 8)],
              },
            ],
          },
          { programId: null, source: "own" },
        ),
      );
      const program = (await inTenant((tx) => loadProgram(tx, tenant.id, saved.programId)))!;
      const p = sessionPlan(program, 0);
      const [reach, lift] = p.items.map((i) => i.itemId);
      // Fixed days in the past, so the test never straddles a midnight.
      const at = (day: number, hour: number) => new Date(2026, 8, day, hour, 0, 0);
      const set = (doc: SessionDoc, itemIndex: number, when: Date) =>
        recordSet(p, doc, { itemIndex, count: 5, setId: randomUUID(), exerciseId: randomUUID(), now: when });

      // A morning half: one set of each, the per-side one on both sides.
      const half = p.items.map((i) => ({ itemId: i.itemId, sets: 1, max: 2 }));
      let morning = beginSession(p, { id: randomUUID(), now: at(20, 8), feelBefore: null, aim: half });
      morning = set(set(morning, 0, at(20, 8)), 0, at(20, 8));
      morning = finishExercise(p, morning, {
        itemIndex: 0,
        effort: null,
        cuesFelt: [],
        hurt: null,
        hurtNote: "",
        now: at(20, 8),
      });
      morning = set(morning, 1, at(20, 8));
      morning = finishSession(morning, { feelAfter: null, now: at(20, 9) });
      // An evening left after one side of the per-side exercise.
      let evening = beginSession(p, { id: randomUUID(), now: at(20, 19), feelBefore: null });
      evening = set(evening, 0, at(20, 19));
      // Another day: never part of the 20th.
      const earlier = set(beginSession(p, { id: randomUUID(), now: at(10, 8), feelBefore: null }), 0, at(10, 8));
      for (const doc of [morning, evening, earlier]) await inTenant((tx) => saveSession(tx, tenant.id, doc));

      const day = morning.localDay;
      const recent = await inTenant((tx) =>
        recentSessions(tx, tenant.id, program.id, shiftDay(day, -1), shiftDay(day, 1)),
      );
      expect(recent.map((s) => s.id)).toEqual([morning.id, evening.id]);
      expect(Object.fromEntries(recent[0].items.map((i) => [i.itemId, i.sets]))).toEqual({ [reach]: 1, [lift]: 1 });
      expect(recent[0]).toMatchObject({ localDay: day, finished: true, endedAt: at(20, 9).toISOString() });
      // One side is not a set yet; the session is still open, and ran to its last set.
      expect(recent[1].items).toEqual([{ itemId: reach, sets: 0 }]);
      expect(recent[1]).toMatchObject({ finished: false, endedAt: at(20, 19).toISOString() });

      const progress = dayProgress(p.items.map(toDayItem), recent);
      expect(progress).toMatchObject({ done: 2, left: 2, complete: false });
      // "Last workout" counts full sets too: the evening's one side is none.
      const last = await inTenant((tx) => lastSession(tx, tenant.id, program.id));
      expect(last).toMatchObject({ id: evening.id, sets: 0 });

      // The Workouts home's Today card follows the latest session.
      const now = beginSession(p, { id: randomUUID(), now: new Date(), feelBefore: null });
      await inTenant((tx) => saveSession(tx, tenant.id, now));
      expect(await inTenant((tx) => latestFollowed(tx, tenant.id))).toEqual({
        programId: program.id,
        phaseId: p.phaseId,
      });
    });

    it("gives every session of a program, with its phase, how it felt and each exercise's effort (F3)", async () => {
      const saved = await inTenant((tx) =>
        saveProgram(tx, tenant.id, { ...aProgram(), name: "Progress" }, { programId: null, source: "own" }),
      );
      const program = (await inTenant((tx) => loadProgram(tx, tenant.id, saved.programId)))!;
      const p = sessionPlan(program, 0);
      const at = (day: number, hour: number) => new Date(2026, 7, day, hour, 0, 0);
      const set = (doc: SessionDoc, when: Date) =>
        recordSet(p, doc, { itemIndex: 0, count: 8, setId: randomUUID(), exerciseId: randomUUID(), now: when });

      let first = beginSession(p, { id: randomUUID(), now: at(3, 8), feelBefore: 4 });
      first = set(set(first, at(3, 8)), at(3, 8));
      first = finishExercise(p, first, {
        itemIndex: 0,
        effort: 6,
        cuesFelt: [],
        hurt: null,
        hurtNote: "",
        now: at(3, 8),
      });
      first = finishSession(first, { feelAfter: 7, now: at(3, 9) });
      // A later day, started and left: no sets, no effort, not finished.
      const later = beginSession(p, { id: randomUUID(), now: at(20, 8), feelBefore: null });
      for (const doc of [first, later]) await inTenant((tx) => saveSession(tx, tenant.id, doc));

      const all = await inTenant((tx) => programSessions(tx, tenant.id, program.id));
      expect(all.map((s) => s.id)).toEqual([first.id, later.id]);
      expect(all[0]).toMatchObject({ phaseId: p.phaseId, feelBefore: 4, feelAfter: 7, efforts: [6], finished: true });
      expect(all[0].items).toEqual([{ itemId: p.items[0].itemId, sets: 2 }]);
      expect(all[1]).toMatchObject({ efforts: [], items: [], finished: false, feelAfter: null });
    });
  });
});
