import { describe, expect, it } from "vitest";
import {
  describeActor,
  describeAuditAction,
  describeAuditMeta,
} from "../src/modules/accounting/history/format";

/**
 * The per-record history panel's pure half.
 *
 * The interesting property is what happens to an action NOBODY WROTE A LABEL
 * FOR. There are 77 accounting actions today and the number only goes up, so
 * the panel has to degrade to a readable sentence rather than to a slug, a
 * blank, or a missing row.
 */

describe("describeAuditAction", () => {
  it("uses an override where derivation reads badly", () => {
    expect(describeAuditAction("bill.approved")).toBe("Approved and posted");
    expect(describeAuditAction("ledger.entry_posted")).toBe("Posted to the ledger");
    expect(describeAuditAction("invoice.emailed")).toBe("Emailed to the customer");
  });

  it("DERIVES a sentence for an action it has never seen", () => {
    // The whole reason this is not a lookup table. A future action gets a
    // reasonable label for free rather than rendering as a raw slug.
    expect(describeAuditAction("banking.reconciliation_reopened")).toBe(
      "Reconciliation reopened",
    );
    expect(describeAuditAction("widgets.completely_new_thing_happened")).toBe(
      "Completely new thing happened",
    );
  });

  it("copes with a malformed action rather than rendering nothing", () => {
    expect(describeAuditAction("nodomain")).toBe("Nodomain");
    expect(describeAuditAction("trailing.")).toBe("trailing.");
    expect(describeAuditAction("")).toBe("");
  });
});

describe("describeActor", () => {
  it("prefers a resolved name, then the stored label", () => {
    expect(describeActor("Dan Rouse", "dan@x.test", "user_1")).toBe("Dan Rouse");
    expect(describeActor(null, "dan@x.test", "user_1")).toBe("dan@x.test");
    expect(describeActor("   ", "dan@x.test", "user_1")).toBe("dan@x.test");
  });

  it("distinguishes a person we cannot name from no person at all", () => {
    // A recurring schedule generating at 3am has nobody behind it, and
    // "A teammate" would imply there was one.
    expect(describeActor(null, null, "user_gone")).toBe("A teammate");
    expect(describeActor(null, null, null)).toBe("The system");
  });
});

describe("describeAuditMeta", () => {
  it("reads only keys with an agreed meaning", () => {
    expect(
      describeAuditMeta({ number: "INV-0007", lineCount: 3, totalCents: 999 }),
    ).toBe("INV-0007 · 3 lines");
  });

  it("says nothing when meta holds nothing a reader can use", () => {
    // Never a jsonb dump: meta carries internal ids and before/after blobs,
    // and rendering it wholesale would leak internal shapes into the UI.
    expect(describeAuditMeta({ entryId: "abc", before: { x: 1 } })).toBe("");
    expect(describeAuditMeta({})).toBe("");
  });

  it("degrades rather than throwing on junk", () => {
    for (const bad of [null, undefined, "text", 42, []]) {
      expect(describeAuditMeta(bad)).toBe("");
    }
  });

  it("phrases a reminder offset the way the schedule does", () => {
    expect(describeAuditMeta({ offset: 0 })).toBe("on the due date");
    expect(describeAuditMeta({ offset: -3 })).toBe("3 days before due");
    expect(describeAuditMeta({ offset: 14 })).toBe("14 days after due");
  });

  it("singularises one line", () => {
    expect(describeAuditMeta({ lineCount: 1 })).toBe("1 line");
  });

  it("mentions a send that was deduped rather than repeated", () => {
    expect(describeAuditMeta({ toDomain: "acme.test", duplicate: true })).toBe(
      "to acme.test · already sent, not re-sent",
    );
  });
});
