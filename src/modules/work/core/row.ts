import type { WorkState } from "@/lib/work/vocabulary";

/**
 * One row, as every surface receives it.
 *
 * ONE SHAPE FOR BOTH DRAWINGS. The list and the board render the same object;
 * neither has its own DTO, because two DTOs over one query is how the two views
 * start disagreeing about what a row is. No directive — the server builds these
 * and the browser renders them.
 *
 * The presentation strings (`listName`, `assigneeLabel`) are resolved on the
 * server, because only it can turn a Clerk id into a person's name. A component
 * renders them and never looks anything up.
 */
export interface WorkRowView {
  id: string;
  title: string;
  state: WorkState;
  status: string;
  dueOn: string | null;
  startsOn: string | null;
  listId: string;
  listName: string;
  listColor: string;
  assignee: string | null;
  assigneeLabel: string | null;
  hasParent: boolean;
}

/** A list, as a picker needs it. */
export interface ListOption {
  id: string;
  name: string;
  color: string;
}

/** A person who can be given work. */
export interface MemberOption {
  clerkUserId: string;
  label: string;
}
