import { describe, expect, it } from "vitest";
import {
  advanceCursor,
  autofileFilter,
  filableParts,
  senderMatches,
  skipReasonFor,
} from "@/modules/email/autofile/match";
import { filableAttachments } from "@/modules/email/filing";
import type { JmapEmail } from "@/lib/email/jmap/types";

/**
 * Automatic filing — the half of attachments → Documents that has no human in
 * it.
 *
 * Every fact these tests pin came from `npm run mail:probe-autofile` against a
 * live Stalwart 0.16.15 rather than from RFC 8621:
 *
 *   • `Email/changes.created` INCLUDES the user's own drafts
 *   • a MOVED message reports as `updated`, never re-created
 *   • `Email/query` honours `hasAttachment`
 *   • a message whose only part is an inline `cid:` logo reports
 *     `hasAttachment: false` — the finding that makes this affordable
 */

function email(over: Partial<JmapEmail> = {}): JmapEmail {
  return {
    id: "m1",
    blobId: "b1",
    threadId: "t1",
    mailboxIds: {},
    keywords: {},
    from: [{ name: null, email: "accounts@supplier.example" }],
    to: [],
    cc: [],
    bcc: [],
    replyTo: [],
    messageId: null,
    inReplyTo: null,
    references: null,
    subject: "Invoice",
    sentAt: null,
    receivedAt: new Date("2026-08-03T09:00:00Z"),
    size: 1000,
    preview: "",
    hasAttachment: true,
    attachments: [
      {
        partId: "2",
        blobId: "att1",
        size: 100,
        name: "invoice.pdf",
        type: "application/pdf",
        charset: null,
        disposition: "attachment",
        cid: null,
      },
    ],
    textBody: null,
    htmlBody: null,
    bodyTruncated: false,
    ...over,
  };
}

describe("autofileFilter", () => {
  it("asks for attachments and excludes drafts", () => {
    const filter = autofileFilter(
      { matchMailboxId: null, cursor: new Date("2026-08-01T00:00:00Z") },
      "inbox-id",
    );
    expect(filter.inMailbox).toBe("inbox-id");
    expect(filter.hasAttachment).toBe(true);
    // The probe found the user's own drafts are visible to the same machinery.
    // Filing somebody's outgoing work back into Documents is the loop this
    // condition exists to prevent.
    expect(filter.notKeyword).toBe("$draft");
  });

  it("STARTS A SECOND BEFORE THE WATERMARK, because `after` is exclusive", () => {
    // The probe contradicted RFC 8621 here: the spec says receivedAt "must be
    // the same as or after this", and this server excludes the boundary. With
    // second-granularity timestamps, two invoices sent together land in the
    // same second — querying at the watermark would step over the second one
    // and nothing would ever say so.
    const cursor = new Date("2026-08-01T12:00:00.000Z");
    const filter = autofileFilter({ matchMailboxId: null, cursor }, "inbox-id");
    expect(filter.after).toEqual(new Date("2026-08-01T11:59:59.000Z"));
    expect(filter.after!.getTime()).toBeLessThan(cursor.getTime());
  });

  it("prefers the rule's own folder over the inbox", () => {
    const filter = autofileFilter(
      { matchMailboxId: "folder-9", cursor: null },
      "inbox-id",
    );
    expect(filter.inMailbox).toBe("folder-9");
  });

  it("NEVER leaves the mailbox unrestricted", () => {
    // An open query would reach Sent and Drafts. The caller passes the inbox as
    // the fallback rather than omitting the condition.
    const filter = autofileFilter({ matchMailboxId: null, cursor: null }, "inbox-id");
    expect(filter.inMailbox).toBe("inbox-id");
    expect(filter.after).toBeUndefined();
  });
});

describe("senderMatches", () => {
  it("matches a case-folded substring of the address", () => {
    expect(senderMatches("Accounts@Supplier.example", "supplier.example")).toBe(true);
    expect(senderMatches("accounts@supplier.example", "  ACCOUNTS  ")).toBe(true);
  });

  it("does not match a different sender", () => {
    expect(senderMatches("someone@else.example", "supplier.example")).toBe(false);
  });

  it("an empty pattern matches everything", () => {
    // Only reachable in combination with a folder — the action refuses a rule
    // that constrains neither, because that one files the whole mailbox.
    expect(senderMatches("anyone@anywhere.example", "")).toBe(true);
    expect(senderMatches("", "")).toBe(true);
  });
});

describe("skipReasonFor", () => {
  const rule = { matchFrom: "supplier.example" };

  it("files an ordinary message from the right sender", () => {
    expect(skipReasonFor(email(), rule)).toBe(null);
  });

  it("REFUSES the user's own draft even though the filter excluded it", () => {
    // Deliberate belt-and-braces. A JMAP condition the server accepted and
    // silently ignored looks exactly like one that worked — the lesson
    // mail:probe-search cost four hand-written checks to learn.
    expect(skipReasonFor(email({ keywords: { $draft: true } }), rule)).toBe("draft");
  });

  it("skips a message from somebody else", () => {
    expect(
      skipReasonFor(email({ from: [{ name: null, email: "spam@elsewhere.example" }] }), rule),
    ).toBe("sender");
  });

  it("skips a message whose only part is an inline cid logo", () => {
    // THE COMMON CASE, not an edge one: this is what every email signature is
    // made of. The server reports hasAttachment=false for it (confirmed live),
    // so it should not arrive here at all — and if it does, it is refused
    // before anything is downloaded.
    const logoOnly = email({
      hasAttachment: true,
      attachments: [
        {
          partId: "2",
          blobId: "logo",
          size: 100,
          name: "logo.png",
          type: "image/png",
          charset: null,
          disposition: "inline",
          cid: "logo1",
        },
      ],
    });
    expect(skipReasonFor(logoOnly, rule)).toBe("no-attachment");
  });

  it("files a message that has a real attachment ALONGSIDE an inline logo", () => {
    const both = email({
      attachments: [
        {
          partId: "2",
          blobId: "logo",
          size: 100,
          name: "logo.png",
          type: "image/png",
          charset: null,
          disposition: "inline",
          cid: "logo1",
        },
        {
          partId: "3",
          blobId: "att",
          size: 200,
          name: "invoice.pdf",
          type: "application/pdf",
          charset: null,
          disposition: "attachment",
          cid: null,
        },
      ],
    });
    expect(skipReasonFor(both, rule)).toBe(null);
    expect(filableParts(both)).toHaveLength(1);
  });

  it("skips a message with no sender rather than matching an empty address", () => {
    expect(skipReasonFor(email({ from: [] }), rule)).toBe("sender");
  });
});

/**
 * `filableParts` is a copy of `filing.ts`'s `filableAttachments`, because that
 * module is `server-only` and this one deliberately is not. A golden test says
 * so — the same arrangement `labelPatch` has with the JMAP client's copy, and
 * the header block has with `file-headers.ts`.
 */
describe("filableParts agrees with the filing path", () => {
  it("returns the same parts for every shape that matters", () => {
    const cases = [
      email(),
      email({ attachments: [] }),
      email({
        attachments: [
          {
            partId: "2",
            blobId: "logo",
            size: 1,
            name: "l.png",
            type: "image/png",
            charset: null,
            disposition: "inline",
            cid: "c1",
          },
          {
            partId: "3",
            blobId: null,
            size: 1,
            name: "gone.pdf",
            type: "application/pdf",
            charset: null,
            disposition: "attachment",
            cid: null,
          },
          {
            partId: "4",
            blobId: "ok",
            size: 1,
            name: "ok.pdf",
            type: "application/pdf",
            charset: null,
            disposition: "attachment",
            cid: null,
          },
        ],
      }),
      // An inline part with NO cid is an ordinary file that happens to be
      // marked inline — both copies keep it.
      email({
        attachments: [
          {
            partId: "2",
            blobId: "x",
            size: 1,
            name: "x.pdf",
            type: "application/pdf",
            charset: null,
            disposition: "inline",
            cid: null,
          },
        ],
      }),
    ];
    for (const message of cases) {
      expect(filableParts(message).map((p) => p.partId)).toEqual(
        filableAttachments(message).map((p) => p.partId),
      );
    }
  });
});

describe("advanceCursor", () => {
  const t = (iso: string) => new Date(iso);

  it("moves to the newest message processed", () => {
    expect(
      advanceCursor(t("2026-08-01T00:00:00Z"), [
        t("2026-08-02T00:00:00Z"),
        t("2026-08-03T00:00:00Z"),
      ]),
    ).toEqual(t("2026-08-03T00:00:00Z"));
  });

  it("NEVER moves backwards", () => {
    // Messages arrive out of order and a page is sorted oldest-first, but a
    // server clock skew must not rewind the watermark and re-file a month.
    expect(
      advanceCursor(t("2026-08-05T00:00:00Z"), [t("2026-08-01T00:00:00Z")]),
    ).toEqual(t("2026-08-05T00:00:00Z"));
  });

  it("ignores a message with no receivedAt", () => {
    // It carries no position. Treating it as "now" would step the cursor over
    // messages that were never considered, and those are lost silently.
    expect(advanceCursor(t("2026-08-01T00:00:00Z"), [null])).toEqual(
      t("2026-08-01T00:00:00Z"),
    );
    expect(advanceCursor(null, [null])).toBe(null);
  });

  it("stays put when nothing was processed", () => {
    expect(advanceCursor(t("2026-08-01T00:00:00Z"), [])).toEqual(
      t("2026-08-01T00:00:00Z"),
    );
  });
});
