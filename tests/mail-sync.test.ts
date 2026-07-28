import { describe, expect, it } from "vitest";
import { foldThreads } from "@/lib/email/sync/account";
import type { JmapEmail } from "@/lib/email/jmap/types";

/**
 * Folding messages into thread-index rows.
 *
 * The only part of sync with rules rather than plumbing, and the rules are all
 * asymmetric on purpose — this index is an aid for joining threads to business
 * records, so being over-inclusive costs a click and being under-inclusive
 * hides the thread somebody was looking for.
 */

function email(over: Partial<JmapEmail> = {}): JmapEmail {
  return {
    id: "m1",
    blobId: "b1",
    threadId: "t1",
    mailboxIds: {},
    keywords: {},
    from: [{ name: "Dana", email: "dana@supplier.example" }],
    to: [{ name: null, email: "me@yosher.test" }],
    cc: [],
    bcc: [],
    replyTo: [],
    messageId: null,
    inReplyTo: null,
    references: null,
    subject: "Invoice 4471",
    sentAt: null,
    receivedAt: new Date("2026-07-20T10:00:00Z"),
    size: 100,
    preview: "",
    hasAttachment: false,
    attachments: [],
    textBody: null,
    htmlBody: null,
    bodyTruncated: false,
    ...over,
  };
}

const SELF = new Set(["me@yosher.test"]);

describe("foldThreads", () => {
  it("collapses a conversation into one row", () => {
    const folded = foldThreads(
      [email({ id: "m1" }), email({ id: "m2" }), email({ id: "m3" })],
      SELF,
    );
    expect(folded.size).toBe(1);
    expect(folded.get("t1")?.messageCount).toBe(3);
  });

  it("keeps the OPENING subject, not the latest", () => {
    // Rewriting the subject on every reply makes the list jitter, and a thread's
    // identity is what it was opened about.
    const folded = foldThreads(
      [
        email({ id: "m1", subject: "Invoice 4471" }),
        email({ id: "m2", subject: "Re: Invoice 4471 — revised" }),
      ],
      SELF,
    );
    expect(folded.get("t1")?.subject).toBe("Invoice 4471");
  });

  it("adopts a later subject only when the first message had none", () => {
    const folded = foldThreads(
      [email({ id: "m1", subject: "" }), email({ id: "m2", subject: "Found one" })],
      SELF,
    );
    expect(folded.get("t1")?.subject).toBe("Found one");
  });

  it("excludes self from participants", () => {
    // Without this, every thread lists the tenant's own address and a module
    // joining against a customer's email would match everything.
    const folded = foldThreads([email()], SELF);
    const people = folded.get("t1")?.participants ?? [];
    expect(people.map((p) => p.email)).toEqual(["dana@supplier.example"]);
  });

  it("dedupes participants case-insensitively, preferring a real name", () => {
    const folded = foldThreads(
      [
        email({ id: "m1", from: [{ name: null, email: "Dana@Supplier.example" }] }),
        email({ id: "m2", from: [{ name: "Dana Reeve", email: "dana@supplier.example" }] }),
      ],
      SELF,
    );
    const people = folded.get("t1")?.participants ?? [];
    expect(people).toHaveLength(1);
    expect(people[0].name).toBe("Dana Reeve");
  });

  it("caps participants so one mailing list cannot bloat a row", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      email({ id: `m${i}`, from: [{ name: null, email: `p${i}@x.example` }] }),
    );
    expect(foldThreads(many, SELF).get("t1")?.participants).toHaveLength(20);
  });

  it("takes the LATEST receivedAt, and ignores the spoofable sentAt", () => {
    const folded = foldThreads(
      [
        email({ id: "m1", receivedAt: new Date("2026-07-20T10:00:00Z") }),
        email({
          id: "m2",
          receivedAt: new Date("2026-07-22T09:00:00Z"),
          // A sender claiming the far future must not reorder the list.
          sentAt: new Date("2030-01-01T00:00:00Z"),
        }),
      ],
      SELF,
    );
    expect(folded.get("t1")?.lastMessageAt?.toISOString()).toBe(
      "2026-07-22T09:00:00.000Z",
    );
  });

  it("makes hasAttachment sticky-true across the thread", () => {
    // Asymmetric on purpose: a filter that returns a thread with no attachment
    // costs a click; one that hides the thread carrying the drawing set costs
    // the job.
    const folded = foldThreads(
      [
        email({ id: "m1", hasAttachment: true }),
        email({ id: "m2", hasAttachment: false }),
      ],
      SELF,
    );
    expect(folded.get("t1")?.hasAttachment).toBe(true);
  });

  it("separates distinct threads", () => {
    const folded = foldThreads(
      [email({ id: "m1", threadId: "t1" }), email({ id: "m2", threadId: "t2" })],
      SELF,
    );
    expect([...folded.keys()].sort()).toEqual(["t1", "t2"]);
  });

  it("skips a message with no threadId rather than inventing one", () => {
    expect(foldThreads([email({ threadId: "" })], SELF).size).toBe(0);
  });

  it("handles an empty batch", () => {
    expect(foldThreads([], SELF).size).toBe(0);
  });

  it("survives a thread where nobody but self was involved", () => {
    // A note-to-self still deserves a row; it just has no participants.
    const folded = foldThreads(
      [email({ from: [{ name: null, email: "me@yosher.test" }], to: [] })],
      SELF,
    );
    expect(folded.get("t1")?.participants).toEqual([]);
    expect(folded.get("t1")?.messageCount).toBe(1);
  });
});
