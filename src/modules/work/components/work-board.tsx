"use client";

import { CornerDownRight } from "lucide-react";
import { WORK_STATE_ORDER, coreStateLabel } from "../core/state";
import type { MemberOption, WorkRowView } from "../core/row";
import { DueBadge, ListBadge } from "./work-list";
import {
  AssigneeControl,
  CloseToggle,
  StateControl,
  useWorkAction,
} from "./item-controls";

/**
 * The board drawing: the same rows, in a column per state.
 *
 * A COLUMN IS NOT A CONTAINER. Trello's board is its data model — a card is
 * *in* the Doing list, so it can be in exactly one board and "everything
 * assigned to me" is unaskable. Here the column is `state`, which is a column
 * on the row, so the board and the list are two renderings of one query and a
 * row can be in both at once.
 *
 * Work moves by MENU, never by dragging — see `StateControl`, and conventions
 * §8 for why.
 *
 * THE BOARD SHOWS FINISHED WORK, because a Done column that is always empty is
 * worse than no Done column. It therefore reads without the open-only filter,
 * and those two columns are unbounded until the read path paginates. That is
 * recorded in the dossier as the second caller wanting it.
 */
export function WorkBoard({
  rows,
  today,
  members,
  showListName,
}: {
  rows: WorkRowView[];
  today: string;
  members: MemberOption[];
  showListName: boolean;
}) {
  const { pending, run } = useWorkAction();

  const byState = new Map<string, WorkRowView[]>();
  for (const row of rows) {
    const bucket = byState.get(row.state);
    if (bucket) bucket.push(row);
    else byState.set(row.state, [row]);
  }

  return (
    // One horizontal scroller rather than a grid that squeezes five columns
    // onto a phone. The page itself never scrolls sideways.
    <div className="-mx-2 overflow-x-auto px-2 pb-2">
      <div className="flex min-w-max gap-3">
        {WORK_STATE_ORDER.map((state) => {
          const items = byState.get(state) ?? [];
          return (
            <section
              key={state}
              className="flex w-[17rem] shrink-0 flex-col gap-2"
              aria-label={coreStateLabel(state)}
            >
              <h2 className="flex items-center justify-between px-1 text-sm font-medium text-muted-foreground">
                {coreStateLabel(state)}
                <span className="tabular-nums">{items.length}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {items.map((row) => (
                  <li
                    key={row.id}
                    className="space-y-2 rounded-lg border bg-card p-3"
                  >
                    <div className="flex items-start gap-2">
                      <CloseToggle row={row} pending={pending} run={run} />
                      <span className="flex flex-1 items-start gap-1 pt-1.5 text-sm">
                        {row.hasParent && (
                          <CornerDownRight
                            className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground"
                            aria-label="Filed under other work"
                          />
                        )}
                        {row.title}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <DueBadge dueOn={row.dueOn} today={today} />
                      {showListName && row.listName && (
                        <ListBadge name={row.listName} color={row.listColor} />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <StateControl
                        row={row}
                        pending={pending}
                        run={run}
                        className="h-8 w-[7.5rem]"
                      />
                      <AssigneeControl
                        row={row}
                        members={members}
                        pending={pending}
                        run={run}
                        className="h-8 w-[7.5rem]"
                      />
                    </div>
                  </li>
                ))}
                {items.length === 0 && (
                  <li className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                    Nothing here
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
