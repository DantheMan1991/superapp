import { describe, expect, it } from "vitest";
import {
  embedUrl,
  formatTimestamp,
  parseTimestamp,
  parseYouTubeUrl,
  watchUrl,
} from "../src/modules/fitness/core/youtube";
import {
  DraftError,
  buildDraftPrompt,
  draftTextProblem,
  normalizeDraft,
  recordProgramTool,
} from "../src/modules/fitness/core/draft";
import {
  emptyProgram,
  prescription,
  programInputSchema,
  programProblems,
  type ProgramInput,
} from "../src/modules/fitness/core/program";
import {
  emptyEditorVideo,
  fromEditor,
  readEditorVideo,
  toEditor,
} from "../src/modules/fitness/core/editor";
import { markVideos } from "../src/modules/fitness/embeds";

/**
 * Workouts' pure half (docs/modules/fitness.md, F1): YouTube links, the draft
 * Claude's answer becomes, the editor's form, and the rules a save is held to.
 * The database half is tests/fitness-ops.test.ts.
 */

describe("YouTube links", () => {
  it("reads every shape the founder's program links with", () => {
    // Taken from Beginner Body Restoration's own link annotations.
    expect(parseYouTubeUrl("https://youtu.be/kd-Ram-Y6gc")).toEqual({ id: "kd-Ram-Y6gc", startS: null });
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=fBViIToMhKA")).toEqual({
      id: "fBViIToMhKA",
      startS: null,
    });
    expect(
      parseYouTubeUrl("https://www.youtube.com/watch?v=kyeuRVoAbuo&feature=youtu.be")?.id,
    ).toBe("kyeuRVoAbuo");
  });

  it("refuses a playlist, which is not one video", () => {
    expect(
      parseYouTubeUrl("https://www.youtube.com/playlist?list=PLFq2zv7d_8BDgk987_f-zLZKe55iWJoQW"),
    ).toBeNull();
  });

  it("reads the other shapes a person pastes, and the start on them", () => {
    expect(parseYouTubeUrl("youtu.be/kd-Ram-Y6gc?t=42")).toEqual({ id: "kd-Ram-Y6gc", startS: 42 });
    expect(parseYouTubeUrl("https://m.youtube.com/watch?v=kd-Ram-Y6gc&t=1m30s")?.startS).toBe(90);
    expect(parseYouTubeUrl("https://www.youtube.com/shorts/kd-Ram-Y6gc")?.id).toBe("kd-Ram-Y6gc");
    expect(parseYouTubeUrl("https://www.youtube-nocookie.com/embed/kd-Ram-Y6gc?start=5")).toEqual({
      id: "kd-Ram-Y6gc",
      startS: 5,
    });
    expect(parseYouTubeUrl("kd-Ram-Y6gc")).toEqual({ id: "kd-Ram-Y6gc", startS: null });
  });

  it("refuses what is not YouTube, or not an id", () => {
    expect(parseYouTubeUrl("https://vimeo.com/123456")).toBeNull();
    expect(parseYouTubeUrl("https://a.co/d/aCTCUfV")).toBeNull();
    expect(parseYouTubeUrl("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseYouTubeUrl("not a link at all")).toBeNull();
  });

  it("reads a timestamp as YouTube writes one and as a person types one", () => {
    expect(parseTimestamp("90")).toBe(90);
    expect(parseTimestamp("90s")).toBe(90);
    expect(parseTimestamp("1m30s")).toBe(90);
    expect(parseTimestamp("1h2m3s")).toBe(3723);
    expect(parseTimestamp("1:30")).toBe(90);
    expect(parseTimestamp("1:02:03")).toBe(3723);
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("soon")).toBeNull();
    expect(formatTimestamp(90)).toBe("1:30");
    expect(formatTimestamp(3723)).toBe("1:02:03");
  });

  it("embeds from youtube-nocookie, inline, with the clip; and links out to YouTube itself", () => {
    const url = new URL(embedUrl({ id: "kd-Ram-Y6gc", startS: 42, endS: 70 }));
    expect(url.hostname).toBe("www.youtube-nocookie.com");
    expect(url.pathname).toBe("/embed/kd-Ram-Y6gc");
    expect(url.searchParams.get("playsinline")).toBe("1");
    expect(url.searchParams.get("start")).toBe("42");
    expect(url.searchParams.get("end")).toBe("70");
    expect(watchUrl({ id: "kd-Ram-Y6gc", startS: 42, endS: null })).toBe(
      "https://www.youtube.com/watch?v=kd-Ram-Y6gc&t=42s",
    );
  });
});

/** A model answer shaped like the tool asks, with the kinds of slips a real one makes. */
function modelAnswer(overrides: Record<string, unknown> = {}) {
  return {
    name: "Starter Mobility",
    author: "A. Coach",
    notes: "Three to four sessions a week. Gentle effort.",
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
            name: "  90/90 hip lift  ",
            purpose: "Controls pelvic tilt.",
            cues: ["Hamstrings only", "", "  Low back relaxed  "],
            unit: "breaths",
            videos: [
              { url: "https://www.youtube.com/watch?v=fBViIToMhKA", label: null },
              // The same video again, and a playlist: both dropped.
              { url: "https://youtu.be/fBViIToMhKA", label: null },
              { url: "https://www.youtube.com/playlist?list=PLx", label: null },
              { url: "https://youtu.be/B5R0uVzCiBA", label: "Alternative" },
            ],
            setsMin: 2,
            setsMax: 2,
            targetMin: 8,
            targetMax: null,
            perSide: false,
            optional: false,
            notes: "",
          },
          {
            name: "Kickstand hinge",
            purpose: "",
            cues: [],
            unit: "reps",
            videos: [],
            // A string where a number was asked for — the streamed input is not validated.
            setsMin: "2",
            setsMax: 3,
            targetMin: 8,
            // A "to" BELOW its "from" is dropped, never swapped.
            targetMax: 6,
            perSide: true,
            optional: false,
            notes: "",
          },
        ],
      },
      // A phase with nothing in it is dropped.
      { name: "Empty", minDoneDays: null, notes: "", items: [] },
    ],
    ...overrides,
  };
}

describe("normalizing Claude's draft", () => {
  it("turns the answer into a program the editor opens, and the save accepts", () => {
    const draft = normalizeDraft(modelAnswer());
    expect(programInputSchema.safeParse(draft).success).toBe(true);
    expect(draft.phases).toHaveLength(1);
    const [lift, hinge] = draft.phases[0].items;
    expect(lift.name).toBe("90/90 hip lift");
    expect(lift.cues).toEqual(["Hamstrings only", "Low back relaxed"]);
    expect(lift.videos.map((v) => v.id)).toEqual(["fBViIToMhKA", "B5R0uVzCiBA"]);
    expect(lift.videos[0].label).toBeNull();
    expect(lift.videos[1].label).toBe("Alternative");
    expect(lift.videos.every((v) => v.embeddable === null)).toBe(true);
    // "2 × 2" is one number, not a range.
    expect([lift.setsMin, lift.setsMax]).toEqual([2, null]);
    expect([hinge.setsMin, hinge.setsMax]).toEqual([2, 3]);
    expect([hinge.targetMin, hinge.targetMax]).toEqual([8, null]);
    expect(draft.phases[0].minDoneDays).toBe(14);
    expect([draft.effortMin, draft.effortMax]).toEqual([3, 5]);
    expect(draft.phases[0].items.every((item) => item.itemId === null && item.exerciseId === null)).toBe(true);
  });

  it("names a second video only with the book's own word, never a guessed one", () => {
    const answer = modelAnswer();
    answer.phases[0].items[0].videos = [
      { url: "https://youtu.be/SSIqhDVOKeI", label: "Main" },
      { url: "https://youtu.be/tt0RQZSqHY0", label: null },
      { url: "https://youtu.be/4xBIa8_s408", label: "   " },
      { url: "https://youtu.be/fyNs7lBsIGs", label: "Alternative" },
    ];
    const videos = normalizeDraft(answer).phases[0].items[0].videos;
    // The first is THE video; the unnamed ones wait for YouTube's title.
    expect(videos.map((v) => v.label)).toEqual([null, null, null, "Alternative"]);
  });

  it("refuses a scan and a book by their words, the one question the device and the server both ask", () => {
    const pdf = (text: string) => ({ fileName: "program.pdf", pageCount: 1, pages: [{ n: 1, text, links: [] }] });
    expect(draftTextProblem(pdf("   "))).toBe("NO_TEXT");
    expect(draftTextProblem(pdf("x".repeat(300_001)))).toBe("TOO_LONG");
    expect(draftTextProblem(pdf("x".repeat(5_000)))).toBeNull();
  });

  it("refuses an answer with no exercises in it, by name", () => {
    expect(() => normalizeDraft(modelAnswer({ phases: [] }))).toThrow(DraftError);
    expect(() => normalizeDraft({ nothing: true })).toThrow(DraftError);
    expect(() => normalizeDraft(null)).toThrow(DraftError);
  });

  it("drops an out-of-scale effort rather than keeping a guess", () => {
    const draft = normalizeDraft(modelAnswer({ effortMin: 30, effortMax: 50 }));
    expect([draft.effortMin, draft.effortMax]).toEqual([null, null]);
  });

  it("asks for every field, and says the pages are data", () => {
    const schema = recordProgramTool.input_schema;
    expect(schema.required).toContain("phases");
    const prompt = buildDraftPrompt({
      fileName: "program.pdf",
      pageCount: 2,
      pages: [
        { n: 1, text: "Hello", links: [] },
        { n: 2, text: "Hip lift", links: ["https://youtu.be/fBViIToMhKA"] },
      ],
    });
    expect(prompt).toContain('<page number="2">');
    expect(prompt).toContain("Links on this page:\n- https://youtu.be/fBViIToMhKA");
    expect(prompt).not.toContain('<page number="1">\nHello\nLinks');
  });
});

describe("the program's rules", () => {
  it("writes the prescription the way the program does", () => {
    expect(
      prescription({ setsMin: 2, setsMax: null, targetMin: 8, targetMax: null, unit: "breaths", perSide: true }),
    ).toBe("2 × 8 breaths per side");
    expect(
      prescription({ setsMin: 2, setsMax: 3, targetMin: 8, targetMax: 10, unit: "reps", perSide: false }),
    ).toBe("2–3 × 8–10 reps");
    expect(
      prescription({ setsMin: 1, setsMax: null, targetMin: 1, targetMax: null, unit: "rolls", perSide: false }),
    ).toBe("1 × 1 roll");
  });

  it("names what stops a save", () => {
    const program: ProgramInput = { ...emptyProgram(), name: "" };
    program.phases[0].items[0].name = "";
    program.phases[0].items[0].setsMax = 0 as unknown as number;
    const problems = programProblems(program);
    expect(problems).toContain("Give the program a name.");
    expect(problems.some((p) => p.includes("needs a name"))).toBe(true);
  });
});

describe("the editor's form", () => {
  it("round-trips a program through the form unchanged", () => {
    const draft = normalizeDraft(modelAnswer());
    const back = fromEditor(toEditor(draft));
    expect(back.problems).toEqual([]);
    expect(back.program).toEqual(draft);
  });

  it("says what is wrong with a count, a range and a video, and saves nothing", () => {
    const form = toEditor(normalizeDraft(modelAnswer()));
    const item = form.phases[0].items[1];
    item.setsMin = "";
    item.targetMax = "ten";
    item.videos = [{ ...emptyEditorVideo(), url: "https://vimeo.com/1" }];
    const result = fromEditor(form);
    expect(result.program).toBeNull();
    expect(result.problems).toEqual(
      expect.arrayContaining([
        "Weeks 1–2, exercise 2: sets needs a number.",
        "Weeks 1–2, exercise 2: count (to) must be a whole number.",
        "Weeks 1–2, exercise 2: That is not a link to one YouTube video.",
      ]),
    );
  });

  it("keeps YouTube's answer only while a row still names the video it was loaded with", () => {
    const [video] = toEditor({
      ...emptyProgram(),
      name: "x",
      phases: [
        {
          phaseId: null,
          name: "One",
          minDoneDays: null,
          notes: "",
          items: [
            {
              ...emptyProgram().phases[0].items[0],
              name: "Lift",
              videos: [{ id: "fBViIToMhKA", startS: 42, endS: null, label: null, embeddable: true }],
            },
          ],
        },
      ],
    }).phases[0].items[0].videos;
    const same = readEditorVideo(video);
    expect(same.ok && same.video).toMatchObject({ id: "fBViIToMhKA", startS: 42, embeddable: true });
    const swapped = readEditorVideo({ ...video, url: "https://youtu.be/B5R0uVzCiBA" });
    expect(swapped.ok && swapped.video.embeddable).toBeNull();
    expect(readEditorVideo({ ...video, start: "soon" }).ok).toBe(false);
  });

  it("reads the checks one per line, dropping bullets and blanks", () => {
    const form = toEditor(normalizeDraft(modelAnswer()));
    form.phases[0].items[0].cues = "- Hamstrings only\n\n• Low back relaxed\n";
    const result = fromEditor(form);
    expect(result.program?.phases[0].items[0].cues).toEqual(["Hamstrings only", "Low back relaxed"]);
  });
});

describe("asking YouTube about a video", () => {
  it("asks once per distinct video, and never again about one already answered and named", async () => {
    const asked: string[] = [];
    const draft = normalizeDraft(modelAnswer());
    // The same video used twice, and one already answered and named.
    draft.phases[0].items[1].videos = [
      { id: "fBViIToMhKA", startS: null, endS: null, label: null, embeddable: null },
      { id: "kd-Ram-Y6gc", startS: null, endS: null, label: "Alternative", embeddable: false },
    ];
    const marked = await markVideos(draft, async (id) => {
      asked.push(id);
      return id === "fBViIToMhKA"
        ? { embeddable: true, title: "90-90 Hip Lift" }
        : { embeddable: null, title: null };
    });
    expect(asked.sort()).toEqual(["B5R0uVzCiBA", "fBViIToMhKA"]);
    const videos = marked.phases.flatMap((p) => p.items.flatMap((i) => i.videos));
    expect(videos.filter((v) => v.id === "fBViIToMhKA").every((v) => v.embeddable === true)).toBe(true);
    expect(videos.find((v) => v.id === "kd-Ram-Y6gc")?.embeddable).toBe(false);
    expect(videos.find((v) => v.id === "B5R0uVzCiBA")?.embeddable).toBeNull();
    // An exercise's first video is THE video: it never takes a name.
    expect(marked.phases[0].items.map((item) => item.videos[0].label)).toEqual([null, null]);
  });

  it("names an unnamed second video with its YouTube title, and leaves a named one alone", async () => {
    // The founder's release sequence: five videos, five different rolls. The
    // first cut of the draft called four of them "Alternative".
    const draft = normalizeDraft(modelAnswer());
    draft.phases[0].items[0].videos = [
      { id: "SSIqhDVOKeI", startS: null, endS: null, label: null, embeddable: true },
      { id: "tt0RQZSqHY0", startS: null, endS: null, label: null, embeddable: true },
      { id: "4xBIa8_s408", startS: null, endS: null, label: "Outer", embeddable: null },
      { id: "LbdTg3QvrfQ", startS: null, endS: null, label: null, embeddable: null },
      { id: "_4RDS9xDS1E", startS: null, endS: null, label: null, embeddable: true },
    ];
    draft.phases[0].items[1].videos = [];
    const titles: Record<string, string | null> = {
      SSIqhDVOKeI: "Quad To Hamstring Roll",
      tt0RQZSqHY0: "Inner Foot Roll",
      "4xBIa8_s408": "Outer Foot Roll",
      LbdTg3QvrfQ: null,
      _4RDS9xDS1E: `Adductor Magnus Roll - Distal to Proximal Emphasis ${"x".repeat(30)}`,
    };
    const asked: string[] = [];
    const marked = await markVideos(draft, async (id) => {
      asked.push(id);
      return { embeddable: titles[id] !== null, title: titles[id] };
    });
    // The first video is answered and wants no name, so it is not asked about.
    expect(asked.sort()).toEqual(["4xBIa8_s408", "LbdTg3QvrfQ", "_4RDS9xDS1E", "tt0RQZSqHY0"]);
    const [first, inner, outer, gone, long] = marked.phases[0].items[0].videos;
    expect(first).toMatchObject({ label: null, embeddable: true });
    expect(inner).toMatchObject({ label: "Inner Foot Roll", embeddable: true });
    // A name the book or the person gave stands.
    expect(outer).toMatchObject({ label: "Outer", embeddable: true });
    // A video that is gone has no title to give.
    expect(gone).toMatchObject({ label: null, embeddable: false });
    // A long title is cut to what a label holds, and the save accepts it.
    expect(long.label).toBe("Adductor Magnus Roll - Distal to Proximal Emphasis xxxxxxxxx");
    expect(programInputSchema.safeParse(marked).success).toBe(true);
  });
});
