import type { JmapMailbox } from "@/lib/email/jmap/types";

/**
 * Labels.
 *
 * **A LABEL IS A MAILBOX.** `npm run mail:probe-labels` settled that against the
 * live server, and it is the reason this file has no schema behind it and the
 * module gained no table.
 *
 * JMAP models a message's location as `mailboxIds` — a MAP, not a value — so a
 * message being in several places at once is native to the protocol rather than
 * something to build. The probe confirmed this server honours it: a message
 * added to a second mailbox stayed in the inbox, `Email/query` found it from
 * both sides, and removing the second left the first alone.
 *
 * So the difference between a folder and a label is **the verb, not the
 * object**:
 *
 *   • *move* — replace the membership; the message leaves where it was
 *   • *label* — add a membership; the message stays where it was
 *
 * The alternative was custom keywords, which the probe also confirmed work
 * (they round-trip and `hasKeyword` filters on them). Rejected deliberately: a
 * keyword is invisible to every other mail client, and this module's founding
 * property is that what Yosher does applies on a phone and in Outlook too. A
 * label that only exists inside our UI would be the one piece of organising
 * that does not travel.
 *
 * Pure, free of `server-only`, and derived entirely from data the list view
 * already has — the same reason `organise/filters.ts` is.
 */

/**
 * Roles that are places rather than labels.
 *
 * A message being in the inbox, or in Sent, is not a tag somebody applied — it
 * is where the mail server put it. Showing "Inbox" as a chip on every row in the
 * inbox would be noise, and offering "apply Drafts" as a label would be a
 * mistake somebody could actually make.
 */
const STRUCTURAL_ROLES = new Set([
  "inbox",
  "archive",
  "drafts",
  "sent",
  "trash",
  "junk",
  "all",
  "flagged",
  "subscribed",
  "important",
]);

/**
 * Mailboxes that can be used as labels.
 *
 * `mayAddItems` is the server's own answer to "may this account put mail here",
 * and it is what keeps a read-only shared folder out of the menu — offering a
 * label that fails on apply is worse than not offering it.
 */
export function labelableFolders(folders: readonly JmapMailbox[]): JmapMailbox[] {
  return folders
    .filter((f) => f.role === null || !STRUCTURAL_ROLES.has(f.role))
    .filter((f) => f.mayAddItems)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AppliedLabel {
  id: string;
  name: string;
}

/**
 * The labels to show on a message.
 *
 * Derived from its `mailboxIds`, minus the folder being viewed. That subtraction
 * is the whole of the presentation logic: inside a folder, saying every row is
 * in that folder tells nobody anything, while the OTHER places it lives are
 * exactly what a chip is for.
 *
 * `currentMailboxId` is null during a search, where results span folders — and
 * there every membership is worth showing, because "where is this?" is the
 * question a search result raises.
 */
export function labelsFor(
  mailboxIds: Readonly<Record<string, boolean>>,
  folders: readonly JmapMailbox[],
  currentMailboxId: string | null,
): AppliedLabel[] {
  const labelable = new Map(labelableFolders(folders).map((f) => [f.id, f.name]));
  return Object.entries(mailboxIds ?? {})
    .filter(([id, present]) => present && id !== currentMailboxId && labelable.has(id))
    .map(([id]) => ({ id, name: labelable.get(id)! }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Which labels a SELECTION has, and whether every message carries each.
 *
 * A bulk label menu has three states per label rather than two — all, some, or
 * none of the selection — and collapsing "some" into either of the others is how
 * a bulk action quietly removes a label from the messages that had it. Clicking
 * a partial label ADDS it to everything, which is the reading people expect and
 * the one that never destroys information.
 */
export function labelStateAcross(
  selection: readonly Readonly<Record<string, boolean>>[],
  folders: readonly JmapMailbox[],
): Map<string, "all" | "some"> {
  const counts = new Map<string, number>();
  const labelable = new Set(labelableFolders(folders).map((f) => f.id));
  for (const mailboxIds of selection) {
    for (const [id, present] of Object.entries(mailboxIds ?? {})) {
      if (present && labelable.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const state = new Map<string, "all" | "some">();
  for (const [id, count] of counts) {
    state.set(id, count === selection.length ? "all" : "some");
  }
  return state;
}

/**
 * The `Email/set` patch that applies and removes labels.
 *
 * Patch syntax (`mailboxIds/<id>`) rather than replacing the whole map, and that
 * is not a micro-optimisation — it is what makes labelling SAFE. Sending a whole
 * `mailboxIds` object would overwrite memberships this client never knew about:
 * a folder another client filed it into, or the inbox itself. A patch touches
 * only the ids named.
 */
export function labelPatch(
  add: readonly string[],
  remove: readonly string[],
): Record<string, true | null> {
  const patch: Record<string, true | null> = {};
  for (const id of remove) patch[`mailboxIds/${id}`] = null;
  // Added second, so an id in both lists ends up applied rather than removed.
  // That ordering is arbitrary but it must be decided somewhere, and "apply"
  // is the non-destructive reading.
  for (const id of add) patch[`mailboxIds/${id}`] = true;
  return patch;
}

/**
 * Refuse a patch that would leave a message in no mailbox at all.
 *
 * A message with an empty `mailboxIds` is not deleted — it is ORPHANED, visible
 * in no folder and reachable only by search, which is a worse outcome than
 * either deleting it or leaving it alone. Removing the last label from a message
 * whose only other home was the folder being viewed is an ordinary way to reach
 * that, so it is checked rather than trusted.
 */
export function wouldOrphan(
  mailboxIds: Readonly<Record<string, boolean>>,
  add: readonly string[],
  remove: readonly string[],
): boolean {
  const after = new Set(
    Object.entries(mailboxIds ?? {})
      .filter(([, present]) => present)
      .map(([id]) => id),
  );
  for (const id of remove) after.delete(id);
  for (const id of add) after.add(id);
  return after.size === 0;
}
