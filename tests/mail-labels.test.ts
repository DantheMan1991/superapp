import { describe, expect, it } from "vitest";
import type { JmapMailbox } from "@/lib/email/jmap/types";
import {
  labelPatch,
  labelStateAcross,
  labelableFolders,
  labelsFor,
  wouldOrphan,
} from "@/modules/email/organise/labels";

/**
 * Labels.
 *
 * THERE IS NO LABELS TABLE, AND THAT IS THE WHOLE DESIGN.
 * `npm run mail:probe-labels` asked the live server which of two mechanisms it
 * supports, and both worked — a message can be in several mailboxes at once, and
 * custom keywords round-trip with `hasKeyword` filtering. Multi-mailbox
 * membership won because a keyword is invisible to every other mail client, and
 * this module's founding property is that what Yosher does applies on a phone
 * and in Outlook too.
 *
 * So **a label IS a mailbox**, and the difference from a folder is the VERB:
 * move replaces the membership, label adds one. Everything below derives from
 * `mailboxIds`, which the list view already has.
 */

function box(over: Partial<JmapMailbox> & { id: string; name: string }): JmapMailbox {
  return {
    parentId: null,
    role: null,
    sortOrder: 0,
    totalEmails: 0,
    unreadEmails: 0,
    totalThreads: 0,
    unreadThreads: 0,
    mayReadItems: true,
    mayAddItems: true,
    mayRemoveItems: true,
    maySetSeen: true,
    mayDelete: true,
    ...over,
  };
}

const INBOX = box({ id: "inbox", name: "Inbox", role: "inbox" });
const SENT = box({ id: "sent", name: "Sent", role: "sent" });
const TRASH = box({ id: "trash", name: "Trash", role: "trash" });
const URGENT = box({ id: "urgent", name: "Urgent" });
const CLIENTS = box({ id: "clients", name: "Clients" });
const READONLY = box({ id: "ro", name: "Shared archive", mayAddItems: false });

const FOLDERS = [INBOX, SENT, TRASH, URGENT, CLIENTS, READONLY];

describe("labelableFolders", () => {
  it("offers user folders and never the structural ones", () => {
    // A message being in the inbox is not a tag somebody applied — it is where
    // the mail server put it. Offering "apply Drafts" is a mistake somebody
    // could actually make.
    const ids = labelableFolders(FOLDERS).map((f) => f.id);
    expect(ids).toEqual(["clients", "urgent"]);
  });

  it("leaves out a folder this account may not write to", () => {
    // The server's own answer. Offering a label that fails on apply is worse
    // than not offering it.
    expect(labelableFolders(FOLDERS).map((f) => f.id)).not.toContain("ro");
  });

  it("sorts by name, so the menu does not reshuffle between renders", () => {
    expect(labelableFolders(FOLDERS).map((f) => f.name)).toEqual([
      "Clients",
      "Urgent",
    ]);
  });
});

describe("labelsFor", () => {
  it("shows the OTHER places a message lives, not the folder being viewed", () => {
    // Inside a folder, saying every row is in that folder tells nobody
    // anything. The other memberships are exactly what a chip is for.
    const labels = labelsFor(
      { inbox: true, urgent: true, clients: true },
      FOLDERS,
      "urgent",
    );
    expect(labels.map((l) => l.name)).toEqual(["Clients"]);
  });

  it("shows every label during a search, where results span folders", () => {
    // `currentMailboxId` is null in a search, and there "where is this?" is
    // precisely the question a result raises.
    const labels = labelsFor({ inbox: true, urgent: true, clients: true }, FOLDERS, null);
    expect(labels.map((l) => l.name)).toEqual(["Clients", "Urgent"]);
  });

  it("never shows a structural folder as a label", () => {
    expect(labelsFor({ inbox: true, sent: true }, FOLDERS, null)).toEqual([]);
  });

  it("ignores a membership that is false, and one we cannot name", () => {
    const labels = labelsFor(
      { urgent: false, clients: true, "gone-from-server": true },
      FOLDERS,
      null,
    );
    expect(labels.map((l) => l.id)).toEqual(["clients"]);
  });

  it("survives a message with no mailboxes at all", () => {
    expect(labelsFor({}, FOLDERS, null)).toEqual([]);
  });
});

describe("labelStateAcross", () => {
  it("distinguishes all, some, and none", () => {
    // Three states rather than two. Collapsing "some" into either of the others
    // is how a bulk action quietly strips a label from the messages that had it.
    const state = labelStateAcross(
      [
        { inbox: true, urgent: true, clients: true },
        { inbox: true, urgent: true },
      ],
      FOLDERS,
    );
    expect(state.get("urgent")).toBe("all");
    expect(state.get("clients")).toBe("some");
    expect(state.has("inbox")).toBe(false);
  });

  it("says nothing about a label nobody in the selection has", () => {
    const state = labelStateAcross([{ inbox: true }], FOLDERS);
    expect(state.size).toBe(0);
  });
});

describe("labelPatch", () => {
  it("uses PATCH syntax rather than replacing the whole map", () => {
    // Sending a whole `mailboxIds` object would overwrite memberships this
    // client never knew about — a folder another client filed it into, or the
    // inbox itself. A patch touches only the ids named.
    expect(labelPatch(["urgent"], ["clients"])).toEqual({
      "mailboxIds/urgent": true,
      "mailboxIds/clients": null,
    });
  });

  it("resolves an id in both lists to APPLIED, the non-destructive reading", () => {
    expect(labelPatch(["urgent"], ["urgent"])).toEqual({ "mailboxIds/urgent": true });
  });

  it("is empty when nothing changes", () => {
    expect(labelPatch([], [])).toEqual({});
  });

  it("matches the patch the JMAP client builds", () => {
    // The client builds its own copy rather than importing this one, because
    // `src/lib` must not depend on `src/modules`. This is the golden test that
    // keeps the two honest — the same role the header block test plays for
    // `file-headers.ts`.
    const add = ["a", "b"];
    const remove = ["c"];
    const clientCopy: Record<string, true | null> = {};
    for (const id of remove) clientCopy[`mailboxIds/${id}`] = null;
    for (const id of add) clientCopy[`mailboxIds/${id}`] = true;
    expect(labelPatch(add, remove)).toEqual(clientCopy);
  });
});

describe("wouldOrphan", () => {
  it("catches removing the last mailbox a message is in", () => {
    // An empty `mailboxIds` is not a deleted message — it is an ORPHANED one,
    // visible in no folder and reachable only by search, which is worse than
    // either deleting it or leaving it alone.
    expect(wouldOrphan({ urgent: true }, [], ["urgent"])).toBe(true);
  });

  it("allows a removal that leaves the message somewhere", () => {
    expect(wouldOrphan({ inbox: true, urgent: true }, [], ["urgent"])).toBe(false);
  });

  it("counts what is being added, so a swap is fine", () => {
    expect(wouldOrphan({ urgent: true }, ["clients"], ["urgent"])).toBe(false);
  });

  it("ignores memberships that are already false", () => {
    expect(wouldOrphan({ urgent: false, clients: true }, [], ["clients"])).toBe(true);
  });
});
