import { describe, expect, it } from "vitest";
import {
  GENERIC_SHOTS,
  readShotNotes,
  spotSubject,
  storedNoteIsFor,
  storeFrom,
  withStoredNotes,
  type Spot,
} from "../src/lib/sites/shots";
import { buildShotsUserTurn } from "../src/modules/marketing/ai/shots-prompt";
import type { SiteBrief } from "../src/lib/sites/copy";

/**
 * Written shot notes (slice 19).
 *
 * The pin is the whole design and the only part that can be got quietly
 * wrong: a spot's key carries a section INDEX, so a note survives an edit it
 * should not unless something compares the words. Everything here is about
 * that boundary.
 */

const spot = (over: Partial<Spot> = {}): Spot => ({
  key: "0:image",
  section: 0,
  sectionLabel: "Hero",
  heading: "A homestead is eight businesses",
  role: "cover",
  shape: "wide",
  label: "Behind the headline",
  note: GENERIC_SHOTS.cover,
  written: false,
  optional: false,
  status: "empty",
  image: null,
  ...over,
});

describe("the pin a note is kept for", () => {
  it("is the section, the heading and the label — not the body", () => {
    expect(spotSubject(spot())).toBe("Hero · A homestead is eight businesses · Behind the headline");
  });

  it("holds while the subject is the same", () => {
    const stored = { note: "The pasture at dawn.", for: spotSubject(spot()) };
    expect(storedNoteIsFor(stored, spot())).toBe(true);
  });

  it("lets go when the heading is rewritten", () => {
    const stored = { note: "The pasture at dawn.", for: spotSubject(spot()) };
    expect(storedNoteIsFor(stored, spot({ heading: "Something else entirely" }))).toBe(false);
  });

  it("lets go when a section is inserted above and the index slides", () => {
    // The KEY still matches — `0:image` is `0:image` — and only the words
    // catch that a different section is now sitting there. This is the case
    // the pin exists for.
    const stored = { note: "The pasture at dawn.", for: spotSubject(spot()) };
    const nowThere = spot({ sectionLabel: "Columns", heading: "How we farm", label: "What this card is about" });
    expect(storedNoteIsFor(stored, nowThere)).toBe(false);
  });

  it("treats an empty note as no note", () => {
    expect(storedNoteIsFor({ note: "   ", for: spotSubject(spot()) }, spot())).toBe(false);
    expect(storedNoteIsFor(undefined, spot())).toBe(false);
  });
});

describe("reading the spots with their notes", () => {
  it("replaces the standing line and says the note was written", () => {
    const s = spot();
    const [out] = withStoredNotes([s], { "0:image": { note: "The pasture at dawn.", for: spotSubject(s) } });
    expect(out!.note).toBe("The pasture at dawn.");
    expect(out!.written).toBe(true);
  });

  it("QUIETLY falls back when the words moved on", () => {
    const s = spot();
    const stale = { "0:image": { note: "The pasture at dawn.", for: "Hero · An older headline · Behind the headline" } };
    const [out] = withStoredNotes([s], stale);
    // Not flagged, not blank: the standing line, as if nothing had been
    // written. Advice about a section that changed is worse than none.
    expect(out!.note).toBe(GENERIC_SHOTS.cover);
    expect(out!.written).toBe(false);
  });

  it("leaves a spot nobody wrote about alone", () => {
    const [out] = withStoredNotes([spot()], {});
    expect(out!.written).toBe(false);
  });
});

describe("what gets stored", () => {
  it("pins each note to the spot it was written for", () => {
    const s = spot();
    expect(storeFrom([s], { "0:image": "  The pasture at dawn.  " })).toEqual({
      "0:image": { note: "The pasture at dawn.", for: spotSubject(s) },
    });
  });

  it("drops a blank answer rather than storing an empty note", () => {
    expect(storeFrom([spot()], { "0:image": "   " })).toEqual({});
  });

  it("drops an answer for a spot that is not on the page", () => {
    expect(storeFrom([spot()], { "9:image": "Invented." })).toEqual({});
  });
});

describe("reading the stored map off the row", () => {
  it("keeps what is well formed and drops what is not", () => {
    expect(
      readShotNotes({
        good: { note: "A note.", for: "Hero · x · y" },
        noPin: { note: "A note." },
        notAnObject: "nope",
        empty: { note: "  ", for: "Hero · x · y" },
      }),
    ).toEqual({ good: { note: "A note.", for: "Hero · x · y" } });
  });

  it("survives anything at all in the column", () => {
    // Advice, not accounting: a malformed entry costs its own spot's note
    // and never throws on the way to a screen.
    for (const raw of [null, undefined, 7, "text", []]) {
      expect(readShotNotes(raw)).toEqual({});
    }
  });
});

describe("what the model is told", () => {
  const brief: SiteBrief = {
    name: "Yosher Homestead",
    tagline: "Farm software for homesteads",
    industry: "Agency",
    phone: "",
    email: "",
    address: "",
    hoursLines: [],
    about: "Books, herd, ground, butcher and farm store in one place.",
  };

  it("carries the business's own words, which is what decides photo or screenshot", () => {
    const turn = buildShotsUserTurn({
      brief,
      pageTitle: "Home",
      pagePath: "/",
      pageDescription: "What Yosher Homestead is.",
      spots: [spot()],
    });
    expect(turn).toContain("Books, herd, ground, butcher and farm store in one place.");
    expect(turn).toContain("Yosher Homestead");
  });

  it("gives every spot its key, its shape and how it is read", () => {
    const turn = buildShotsUserTurn({
      brief,
      pageTitle: "Home",
      pagePath: "/",
      pageDescription: "",
      spots: [spot(), spot({ key: "2:card.1", role: "card", shape: "landscape", label: "The herd" })],
    });
    expect(turn).toContain("key: 0:image");
    expect(turn).toContain("key: 2:card.1");
    expect(turn).toContain("Wide");
    // The role has to arrive as WORDS, not as the enum: "cover" tells a model
    // nothing, and "the headline sits ON it" tells it where the subject goes.
    expect(turn).toContain("the headline sitting ON it");
  });

  it("bounds a screenshot with the tools the PRODUCT ships", () => {
    const turn = buildShotsUserTurn({
      brief,
      pageTitle: "Home",
      pagePath: "/",
      pageDescription: "",
      spots: [spot()],
      catalogue: [
        { name: "Livestock", description: "Animals tracked as lots — health, movement, breeding and what each one has cost." },
        { name: "Land", description: "Parcels and the zones inside them." },
      ],
    });
    expect(turn).toContain("THE TOOLS THIS PRODUCT SHIPS");
    expect(turn).toContain("Livestock: Animals tracked as lots");
    // The catalogue comes FIRST, before the business and the spots: it is the
    // bound on the answer, not a detail of it.
    expect(turn.indexOf("THE TOOLS")).toBeLessThan(turn.indexOf("THE BUSINESS"));
  });

  it("tells the model to keep to photographs when it is given no catalogue", () => {
    // A screenshot note with nothing to point at is the exact failure this
    // bound exists to stop: it sends somebody hunting for a screen.
    const turn = buildShotsUserTurn({
      brief,
      pageTitle: "Home",
      pagePath: "/",
      pageDescription: "",
      spots: [spot()],
    });
    expect(turn).toContain("ask for photographs, not screenshots");
  });

  it("says when a spot is optional, so a note can decline it", () => {
    const turn = buildShotsUserTurn({
      brief,
      pageTitle: "Home",
      pagePath: "/",
      pageDescription: "",
      spots: [spot({ optional: true })],
    });
    expect(turn).toContain("optional");
  });
});
