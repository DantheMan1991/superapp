import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SHEET_NUMBER_PATTERN,
  compareDisciplines,
  compareSheetNumbers,
  currentIssues,
  disciplineLabel,
  disciplineOf,
  guessSheet,
  issuesOf,
  tickedByDefault,
  disciplineOrderFrom,
  disciplineRank,
  linesFrom,
  sheetNumberIn,
  stackedTitle,
  normaliseSheetNumber,
  summariseDrawings,
  titleCase,
  type PageText,
  type SheetIssue,
} from "../src/packs/jobs/drawings-math";
import { DISCIPLINE_LABELS, DISCIPLINE_ORDER, DRAWING_DOC_KIND, DRAWING_SET_ENTITY, OTHER_DISCIPLINE } from "../src/packs/jobs/vocabulary";

/**
 * The arithmetic of a drawing set (ADR 0072), pure: which number a page
 * carries, which issue of it is current, how the set reads. The database
 * suites prove the rows; this proves the rules the page and the ops share.
 */

const SQL = readFileSync("drizzle/0361_job_drawings.sql", "utf8");

describe("the database agrees with the words", () => {
  it("MIRRORS the CHECKs and the uniques the ops rely on", () => {
    expect(SQL).toMatch(/job_sheets_page_positive[^;]*>= 1/);
    expect(SQL).toMatch(/job_sheets_number_present[^;]*length\(btrim/);
    expect(SQL).toMatch(/job_drawing_sets_name_present[^;]*length\(btrim/);
    // One number per issue and one page per issue: `indexSheets` refuses both in words before the database does.
    expect(SQL).toMatch(/CREATE UNIQUE INDEX "job_sheets_set_number_idx"[^;]*\("tenant_id","set_id","sheet_number"\)/);
    expect(SQL).toMatch(/CREATE UNIQUE INDEX "job_sheets_set_page_idx"[^;]*\("tenant_id","set_id","document_id","page_number"\)/);
  });

  it("was HAND-REORDERED: the set's own unique index comes before the sheet's key to it", () => {
    const index = SQL.indexOf('CREATE UNIQUE INDEX "job_drawing_sets_tenant_id_id_idx"');
    const key = SQL.indexOf('ADD CONSTRAINT "job_sheets_set_fk"');
    expect(index).toBeGreaterThan(-1);
    expect(key).toBeGreaterThan(-1);
    expect(index).toBeLessThan(key);
    expect(SQL.startsWith("-- Hand-reordered")).toBe(true);
  });

  it("cascades the way the words say: a sheet goes with its job, its set and its FILE; a set goes with its job and holds its party", () => {
    expect(SQL).toMatch(/"job_sheets_project_fk"[^;]*ON DELETE cascade/);
    expect(SQL).toMatch(/"job_sheets_set_fk"[^;]*ON DELETE cascade/);
    expect(SQL).toMatch(/"job_sheets_document_fk"[^;]*REFERENCES "public"\."documents"\("tenant_id","id"\) ON DELETE cascade/);
    expect(SQL).toMatch(/"job_drawing_sets_project_fk"[^;]*ON DELETE cascade/);
    expect(SQL).toMatch(/"job_drawing_sets_party_fk"[^;]*ON DELETE no action/);
  });

  it("names the seams the attach actions and the cabinet share", () => {
    expect(DRAWING_SET_ENTITY).toBe("job_drawing_set");
    expect(DRAWING_DOC_KIND).toBe("drawing");
    for (const key of DISCIPLINE_ORDER) expect(DISCIPLINE_LABELS[key]).toBeTruthy();
    expect(Object.keys(DISCIPLINE_LABELS).sort()).toEqual([...DISCIPLINE_ORDER].sort());
  });
});

describe("sheet numbers", () => {
  it("normalises: trimmed, upper-cased, one space at most", () => {
    expect(normaliseSheetNumber(" a-101 ")).toBe("A-101");
    expect(normaliseSheetNumber("A  1.1")).toBe("A 1.1");
    expect(normaliseSheetNumber("s2.1")).toBe("S2.1");
    expect(normaliseSheetNumber("   ")).toBe("");
  });

  it("reads the discipline off the first letter, and files what it does not know under Other", () => {
    expect(disciplineOf("A-101")).toBe("A");
    expect(disciplineOf("a1.1")).toBe("A");
    expect(disciplineOf("AD-101")).toBe("A");
    expect(disciplineOf("S2.1")).toBe("S");
    expect(disciplineOf("E-001")).toBe("E");
    expect(disciplineOf("FP-2")).toBe("F");
    expect(disciplineOf("C1.0")).toBe("C");
    expect(disciplineOf("L 1")).toBe("L");
    expect(disciplineOf("12")).toBe(OTHER_DISCIPLINE);
    expect(disciplineOf("K-1")).toBe(OTHER_DISCIPLINE);
    expect(disciplineOf("SHEET")).toBe(OTHER_DISCIPLINE);
    expect(disciplineLabel("A")).toBe("Architectural");
    expect(disciplineLabel(OTHER_DISCIPLINE)).toBe(OTHER_DISCIPLINE);
    expect(disciplineLabel("?")).toBe(OTHER_DISCIPLINE);
  });

  it("orders disciplines the way the index page does, Other last", () => {
    expect(["E", "A", OTHER_DISCIPLINE, "S", "G"].sort(compareDisciplines)).toEqual(["G", "S", "A", "E", OTHER_DISCIPLINE]);
  });

  it("sorts naturally within a discipline: A-2 before A-10, A1.2 before A1.10, and the discipline first", () => {
    const sorted = ["A-10", "A-2", "S-1", "G-001", "A1.2", "A1.10", "A1.1", "E-101", "12", "M101"].sort(compareSheetNumbers);
    expect(sorted).toEqual(["G-001", "S-1", "A1.1", "A1.2", "A1.10", "A-2", "A-10", "M101", "E-101", "12"]);
    expect(compareSheetNumbers("A-1", "A-01")).toBeLessThan(0);
    expect(compareSheetNumbers("a-101", "A-101")).toBe(0);
  });

  it("knows a sheet number when it sees one, and a date, a scale or a paper size when it does not", () => {
    for (const ok of ["A-101", "A1.1", "S-201A", "E-001", "FP-2", "C1.0", "M101", "L-1", "A 101", "AD-101", "G-0.01"]) {
      expect(SHEET_NUMBER_PATTERN.test(ok), ok).toBe(true);
    }
    for (const no of ['1/4"', "03/15/2026", "SHEET", "A-", "2026-09-15", "A-101-B-2", "1234", "ABCD-1", ""]) {
      expect(SHEET_NUMBER_PATTERN.test(no), no).toBe(false);
    }
  });
});

describe("the current set", () => {
  const issue = (id: string, sheetNumber: string, issuedOn: string, setCreatedAt: string): SheetIssue => ({ id, sheetNumber, issuedOn, setCreatedAt });
  const permit = [
    issue("p-a101", "A-101", "2026-06-01", "2026-06-02T10:00:00.000Z"),
    issue("p-a102", "A-102", "2026-06-01", "2026-06-02T10:00:00.000Z"),
    issue("p-s201", "S-201", "2026-06-01", "2026-06-02T10:00:00.000Z"),
  ];
  const asi = [issue("i-a102", "a-102", "2026-08-15", "2026-08-15T09:00:00.000Z"), issue("i-a104", "A-104", "2026-08-15", "2026-08-15T09:00:00.000Z")];
  const reissue = [issue("r-a102", "A-102", "2026-08-15", "2026-08-15T15:00:00.000Z")];

  it("is the newest issue of each number, by the date on the drawings and then by which set was made later", () => {
    const current = currentIssues([...permit, ...asi, ...reissue]);
    expect([...current.entries()].map(([k, v]) => [k, v.id])).toEqual([
      ["A-101", "p-a101"],
      ["A-102", "r-a102"],
      ["S-201", "p-s201"],
      ["A-104", "i-a104"],
    ]);
    // The same set of rows in any order gives the same answer.
    const shuffled = currentIssues([...reissue, ...permit, ...asi].reverse());
    expect(shuffled.get("A-102")?.id).toBe("r-a102");
  });

  it("lists every issue of a number newest first, whatever the case it was typed in", () => {
    expect(issuesOf([...permit, ...asi, ...reissue], "a-102").map((s) => s.id)).toEqual(["r-a102", "i-a102", "p-a102"]);
    expect(issuesOf(permit, "A-999")).toEqual([]);
  });

  it("summarises: the current count, the sets, the superseded, the newest set and the disciplines in reading order", () => {
    const sets = [
      { name: "Permit set", issuedOn: "2026-06-01", createdAt: "2026-06-02T10:00:00.000Z" },
      { name: "ASI 1", issuedOn: "2026-08-15", createdAt: "2026-08-15T09:00:00.000Z" },
      { name: "ASI 1 reissued", issuedOn: "2026-08-15", createdAt: "2026-08-15T15:00:00.000Z" },
    ];
    expect(summariseDrawings([...permit, ...asi, ...reissue], sets)).toEqual({
      sheets: 4,
      sets: 3,
      superseded: 2,
      latestSetName: "ASI 1 reissued",
      latestIssuedOn: "2026-08-15",
      disciplines: ["S", "A"],
    });
    expect(summariseDrawings([], [])).toEqual({ sheets: 0, sets: 0, superseded: 0, latestSetName: null, latestIssuedOn: null, disciplines: [] });
  });
});

describe("reading a title block", () => {
  const run = (str: string, x: number, y: number, width = str.length * 6, height = 10): PageText => ({ str, x, y, width, height });
  const W = 792;
  const H = 612;

  it("joins runs on one baseline into a line, and keeps different baselines apart", () => {
    const lines = linesFrom([run("FIRST", 500, 40, 30), run("FLOOR", 533, 40, 30), run("PLAN", 566, 40, 24), run("SCALE", 500, 20, 30), run("FAR AWAY", 700, 40, 48)]);
    expect(lines.map((l) => l.text)).toEqual(["FIRST FLOOR PLAN", "FAR AWAY", "SCALE"]);
    expect(lines[0].width).toBeCloseTo(90);
  });

  it("finds the number nearest the bottom-right corner and the biggest other line beside it as the title, ignoring the cover's index and the header", () => {
    const items = [
      run("MILLER BARN CONVERSION", 20, 590, 140, 14),
      run("A-102", 300, 400),
      run("A-103", 300, 385),
      run("SECOND FLOOR PLAN", 340, 400),
      run("SHEET", 740, 42, 30, 5),
      run("DATE", 700, 42, 24, 5),
      run("06/01/2026", 700, 30, 50, 6),
      run("SCALE", 640, 42, 30, 5),
      run('1/4" = 1\'-0"', 640, 30, 50, 6),
      run("FIRST", 690, 70, 30, 12),
      run("FLOOR", 723, 70, 30, 12),
      run("PLAN", 756, 70, 24, 12),
      run("A-101", 740, 18, 40, 18),
    ];
    expect(guessSheet(items, W, H)).toEqual({ sheetNumber: "A-101", title: "First floor plan", reason: "title block" });
  });

  it("reads a vertical title strip on the right edge the same way", () => {
    const items = [run("ROOF PLAN", 770, 200, 10, 12), run("A-104", 770, 40, 12, 16), run("SOME NOTE ABOUT FLASHING", 100, 300, 150, 8)];
    expect(guessSheet(items, W, H)).toMatchObject({ sheetNumber: "A-104", title: "Roof plan" });
  });

  it("says when there is no text, and when no number-shaped line sits in the corner", () => {
    expect(guessSheet([], W, H)).toEqual({ sheetNumber: "", title: "", reason: "no text on the page" });
    expect(guessSheet([run("GENERAL NOTES", 100, 500), run("A-101", 20, 590)], W, H)).toEqual({ sheetNumber: "", title: "", reason: "no number found" });
  });

  it("does not mistake the paper size for the sheet", () => {
    const items = [run("A4", 760, 10, 14, 8), run("S-201", 730, 30, 40, 16), run("FOUNDATION PLAN", 680, 60, 90, 12)];
    expect(guessSheet(items, W, H)).toMatchObject({ sheetNumber: "S-201", title: "Foundation plan" });
  });

  it("starts a row ticked when it was indexed before or a number was found on a first read, and UNTICKED on a re-read for a page left out before", () => {
    expect(tickedByDefault(true, true, "")).toBe(true);
    expect(tickedByDefault(false, false, "A-101")).toBe(true);
    expect(tickedByDefault(false, false, "")).toBe(false);
    // The cover was left out on purpose the first time; reading the file again must not tick it back in.
    expect(tickedByDefault(false, true, "G-001")).toBe(false);
  });

  it("stops shouting: an all-caps title is sentence case, a mixed-case one is kept", () => {
    expect(titleCase("FIRST FLOOR PLAN")).toBe("First floor plan");
    expect(titleCase("Roof Plan")).toBe("Roof Plan");
    expect(titleCase("  ELECTRICAL   LIGHTING ")).toBe("Electrical lighting");
  });
});

/**
 * **A REAL SET'S TITLE BLOCK**, and the reason this block exists.
 *
 * The founder uploaded a 37-page Revit set and it read **7 pages, badly**:
 * five of the seven were detail callouts — `FW3`, `W9`, `FN14` — picked up
 * from the middle of the paper, and the titles were the PROJECT name. The
 * tests above all passed throughout, because every one of them is a title
 * block somebody made up. The geometry below is measured off that file: a
 * 2592x1728 sheet, the number cell in 37.5pt type at y=111, the sheet name
 * in 24.9pt on two lines at y=265 and 293, and the project name in the same
 * 24.9pt directly under it at 336, 364 and 392.
 *
 * With them the reader gets **37 of 37**.
 */
describe("a Revit title block, off the real set", () => {
  const W = 2592;
  const H = 1728;
  const at = (str: string, x: number, y: number, height: number): PageText => ({ str, x, y, width: 0, height });

  /** Every run in that set reports width 0, which is why the cells join. */
  const titleBlock = (number: string, name: string[]) => [
    at("9/21/2026 4:19:58 PM", 2535, 73, 9.5),
    at("Scale", 2281, 87, 9.6),
    at(number, 2336, 111, 37.5),
    at("JS/DH/RK", 2447, 154, 12.5),
    at("Checked by", 2281, 155, 9.6),
    at("RLR", 2480, 172, 12.5),
    at("Drawn by", 2281, 173, 9.6),
    at("09/21/26", 2456, 190, 12.5),
    at("Date", 2281, 191, 9.6),
    ...name.map((line, i) => at(line, 2334, 265 + i * 28, 24.9)),
    at("RESIDENCE", 2321, 336, 24.9),
    at("WRIGHT - NEW", 2303, 364, 24.9),
    at("SAM & TATE", 2319, 392, 24.9),
  ];

  it("reads the number out of a cell joined to its neighbour", () => {
    /** The index cell and the number cell arrive as one line: "2 A1.1". */
    expect(guessSheet(titleBlock("2 A1.1", ["3D VIEWS"]), W, H)).toEqual({
      sheetNumber: "A1.1",
      title: "3d views",
      reason: "title block",
    });
  });

  it("reads a sheet name set on two lines, and stops before the project name", () => {
    const guess = guessSheet(titleBlock("22 S1.0", ["PLAN", "FOUNDATION"]), W, H);
    expect(guess.sheetNumber).toBe("S1.0");
    /** NOT "Plan", and NOT "Foundation plan sam & tate wright - new residence". */
    expect(guess.title).toBe("Foundation plan");
  });

  /**
   * **SIZE BEATS NEARNESS, and this is what the old order got wrong.** A
   * title block's number cell is inset from the paper edge; a callout bubble
   * can sit anywhere, including lower and further right. The number is the
   * biggest thing in that corner by a factor of three.
   */
  it("does not hand the answer to a callout sitting closer to the corner", () => {
    const withCallout = [...titleBlock("22 S1.0", ["PLAN", "FOUNDATION"]), at("FW3", 2560, 40, 9.5)];
    expect(guessSheet(withCallout, W, H).sheetNumber).toBe("S1.0");
  });
});

describe("sheetNumberIn", () => {
  it("takes the one number-shaped word in a line", () => {
    expect(sheetNumberIn("2 A1.1")).toBe("A1.1");
    expect(sheetNumberIn("A-101")).toBe("A-101");
    expect(sheetNumberIn("13 A2.4")).toBe("A2.4");
  });

  /** A plausible wrong sheet number is silently wrong forever. One or none. */
  it("refuses a line with two of them", () => {
    expect(sheetNumberIn("A1.1 A1.2")).toBe("");
  });

  it("still refuses a paper size, and anything with no number in it", () => {
    expect(sheetNumberIn("A4")).toBe("");
    expect(sheetNumberIn("22 A4")).toBe("");
    expect(sheetNumberIn("FOUNDATION PLAN")).toBe("");
    expect(sheetNumberIn("")).toBe("");
  });
});

describe("stackedTitle", () => {
  const line = (text: string, y: number, height = 24.9) => ({ text, x: 2300, y, width: 0, height });

  it("reads a name up the page and joins it top down", () => {
    const plan = line("PLAN", 265);
    const all = [plan, line("FOUNDATION", 293), line("RESIDENCE", 336)];
    expect(stackedTitle(plan, all)).toBe("FOUNDATION PLAN");
  });

  it("keeps a one-line name to itself", () => {
    const views = line("3D VIEWS", 293);
    expect(stackedTitle(views, [views, line("RESIDENCE", 336)])).toBe("3D VIEWS");
  });

  it("ignores lines of another size, whatever the leading", () => {
    const seed = line("DETAILS", 265);
    expect(stackedTitle(seed, [seed, line("IN-FLOOR BEAM", 290, 12.6)])).toBe("DETAILS");
  });
});

/**
 * **THE BUSINESS'S READING ORDER OVER THE STANDARD'S.**
 *
 * `DISCIPLINE_ORDER` is the US National CAD Standard's, and it genuinely puts
 * **S before A**. The founder, looking at his own house: *"I should be able
 * to organize the categories. architectural, then structural etc. right now
 * structural shows first but I would not want that."* Both are right, which
 * is why it is config and not a corrected constant.
 */
describe("the order a business reads its disciplines in", () => {
  it("is the standard's when nothing has been said", () => {
    expect(["A", "S", "E"].sort(compareDisciplines)).toEqual(["S", "A", "E"]);
  });

  it("is the business's where the business has spoken", () => {
    const mine = ["A", "S"];
    expect(["A", "S", "E"].sort((a, b) => compareDisciplines(a, b, mine))).toEqual(["A", "S", "E"]);
  });

  /**
   * Naming one discipline must not shuffle the rest: everything unnamed keeps
   * its place in the standard's own order, after everything named.
   */
  it("keeps what was never named in the standard's order, after what was", () => {
    const mine = ["E"];
    expect(["A", "S", "E", "G"].sort((a, b) => compareDisciplines(a, b, mine))).toEqual(["E", "G", "S", "A"]);
  });

  it("leaves Other last unless it was asked for earlier", () => {
    expect(["Other", "A", "S"].sort(compareDisciplines)).toEqual(["S", "A", "Other"]);
    expect(["Other", "A", "S"].sort((a, b) => compareDisciplines(a, b, ["Other"]))).toEqual(["Other", "S", "A"]);
  });

  /** The whole set reads in that order too, not just the headings. */
  it("orders sheet numbers by it as well", () => {
    const sheets = ["S1.0", "A1.1", "A1.2", "S2.0"];
    expect([...sheets].sort((a, b) => compareSheetNumbers(a, b, ["A"]))).toEqual(["A1.1", "A1.2", "S1.0", "S2.0"]);
    expect([...sheets].sort((a, b) => compareSheetNumbers(a, b))).toEqual(["S1.0", "S2.0", "A1.1", "A1.2"]);
  });

  it("ranks a discipline the business named ahead of every one it did not", () => {
    expect(disciplineRank("A", ["A"])).toBe(0);
    expect(disciplineRank("G", ["A"])).toBeGreaterThan(disciplineRank("A", ["A"]));
  });
});

describe("disciplineOrderFrom", () => {
  it("reads the order out of the pack's config", () => {
    expect(disciplineOrderFrom({ disciplineOrder: ["A", "S"] })).toEqual(["A", "S"]);
  });

  /** A key nothing can label would sort a section under a blank heading. */
  it("drops what the convention does not know, and repeats", () => {
    expect(disciplineOrderFrom({ disciplineOrder: ["A", "ZZTOP", 7, "A", "Other"] })).toEqual(["A", "Other"]);
  });

  it("is empty for a business that has said nothing, and for nonsense", () => {
    expect(disciplineOrderFrom({})).toEqual([]);
    expect(disciplineOrderFrom(null)).toEqual([]);
    expect(disciplineOrderFrom({ disciplineOrder: "A,S" })).toEqual([]);
    expect(disciplineOrderFrom([{ disciplineOrder: ["A"] }])).toEqual([]);
  });

  /** The jsonb it shares with tabsOff and the profile's lists is untouched. */
  it("ignores everything else in the config", () => {
    expect(disciplineOrderFrom({ tabsOff: ["warranty"], disciplineOrder: ["A"] })).toEqual(["A"]);
  });
});
