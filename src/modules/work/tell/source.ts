import type { Tx } from "@/db";
import {
  TellRefusal,
  type TellAction,
  type TellChoice,
  type TellCtx,
  type TellSource,
  type TellValues,
} from "@/lib/tell-sources/types";
import { WorkError } from "@/lib/work/errors";
import {
  createUnlinkedWork,
  listOpenWork,
  setWorkComplete,
} from "@/lib/work/entity-work";

/**
 * What Work can be told in one sentence — *"add a job to fix the top gate"*.
 *
 * THE FIRST SOURCE THAT IS NOT ABOUT A FARM. Livestock's four actions and
 * Time's two clocks are both things a specific kind of business does; every
 * business alive has a list of things that need doing. If "it should work with
 * every tool" means anything, this is the one that proves the slot is not a
 * farm feature wearing a general coat.
 *
 * ── IT WRITES THROUGH `src/lib/work/`, NOT THROUGH THE MODULE ────────────────
 *
 * `createUnlinkedWork` and `setWorkComplete` live in `src/lib/work/` precisely
 * because anything may raise a work item and a module may not import another
 * module (work.md §4b). This source is one more caller of that seam, which is
 * why it needs nothing from `src/modules/work/` at all.
 *
 * ── THE TWO ACTIONS ARE NOT THE SAME KIND OF SAFE ────────────────────────────
 *
 * `work.add` records itself (ADR 0050); `work.done` does not, and the
 * difference is instructive rather than cautious.
 *
 * A job added by mistake APPEARS on a list — visible, removable in one press,
 * moving no quantity. All three tests pass.
 *
 * A job ticked by mistake **disappears from the open list**, which fails the
 * first test outright: the wrong one is now harder to see, not easier. And its
 * real-world consequence is not a tidy-up — somebody believes the gate is shut
 * when it is open. So ticking is read back and confirmed, always.
 */

const text = (v: TellValues[string]): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Work's own refusals, in its own words — ADR 0039's third rule. */
function refusal(err: unknown): unknown {
  return err instanceof WorkError ? new TellRefusal(err.message) : err;
}

export const workTellSource: TellSource = {
  slug: "work",
  moduleSlug: "work",
  label: "Work",
  revalidate: ["/dashboard/m/work", "/dashboard/today"],

  async actions(tx: Tx, ctx: TellCtx): Promise<TellAction[]> {
    const workCtx = { tenantId: ctx.tenantId, userId: ctx.userId };

    const actions: TellAction[] = [
      {
        slug: "work.add",
        title: "Job added",
        about:
          "Something that needs doing, written down so it is not forgotten. Examples: “add a job to fix the top gate”, “remind me to call the vet”, “we need to order more feed bags by Friday”. Use this for anything somebody has to DO later — not for recording something that has already happened.",
        // ADR 0050. A job added by mistake is on the list, removable in one
        // press, and moves nothing. All three tests pass.
        unattended: true,
        fields: [
          {
            key: "title",
            label: "What needs doing",
            kind: "text",
            required: true,
            hint: "The job itself, in as few words as the sentence allows. “Fix the top gate”, not “we need to fix the top gate”.",
          },
          {
            key: "due",
            label: "By when",
            kind: "date",
            hint: "Only when the sentence says when. A job with no date is perfectly normal — do NOT fill this in with today.",
          },
          {
            key: "notes",
            label: "Anything else",
            kind: "text",
            hint: "Detail the title does not carry. Usually empty.",
          },
        ],
        async record(tx, ctx, values) {
          const title = text(values.title);
          if (!title) throw new TellRefusal("a job needs saying what it is");
          try {
            await createUnlinkedWork(
              tx,
              { tenantId: ctx.tenantId, userId: ctx.userId },
              {
                title,
                notes: text(values.notes) ?? "",
                dueOn: text(values.due),
              },
            );
          } catch (err) {
            throw refusal(err);
          }
          const by = text(values.due);
          return { summary: by ? `${title} — due ${by}` : title };
        },
      },
    ];

    /*
     * TICKING ONE OFF IS ONLY OFFERED WHEN THERE IS SOMETHING TO TICK.
     *
     * The same reasoning livestock uses for offering only lots with animals in
     * them: an action whose every choice is empty is an action the model can
     * pick and then fail to fill, which costs a person a readback that could
     * never have gone anywhere. Newly open work only — a finished job is not
     * something anybody is standing in front of saying is finished.
     */
    const open = await listOpenWork(tx, workCtx);
    if (open.length > 0) {
      const choices: TellChoice[] = open
        .filter((row) => row.title.trim() !== "")
        .map((row) => ({ value: row.id, label: row.title }));

      if (choices.length > 0) {
        actions.push({
          slug: "work.done",
          title: "Job finished",
          about:
            "A job on the list has been done. Examples: “the top gate is fixed”, “I've called the vet”, “ordered the feed”. Only choose this when the sentence is about something ALREADY on the list — describing new work is the other action.",
          // Deliberately NOT unattended. See the header: a wrongly ticked job
          // leaves the open list, so the mistake becomes harder to see rather
          // than easier, and somebody believes a gate is shut when it is open.
          fields: [
            {
              key: "item",
              label: "Which job",
              kind: "choice",
              required: true,
              hint: "The job the sentence says is finished.",
              choices,
            },
          ],
          async record(tx, ctx, values) {
            const itemId = text(values.item);
            if (!itemId) throw new TellRefusal("say which job is finished");
            try {
              await setWorkComplete(
                tx,
                { tenantId: ctx.tenantId, userId: ctx.userId },
                itemId,
                true,
              );
            } catch (err) {
              throw refusal(err);
            }
            const label =
              choices.find((c) => c.value === itemId)?.label ?? "that job";
            return { summary: `${label} — done` };
          },
        });
      }
    }

    return actions;
  },
};
