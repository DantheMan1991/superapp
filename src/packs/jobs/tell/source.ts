import type { Tx } from "@/db";
import {
  TellRefusal,
  type TellAction,
  type TellCtx,
  type TellSource,
  type TellValues,
} from "@/lib/tell-sources/types";
import { WorkError } from "@/lib/work/errors";
import { JobsError, listProjects } from "../ops";
import { addCrew, addPunchItem, saveDailyLog } from "../field-ops";
import { PACK, tenthsToHours } from "../vocabulary";
import { findProjects, type OpenProject } from "./find";

/**
 * What a job can be told from the site (construction slice 7).
 *
 * *"Poured the garage slab at Oak Row, four guys, six hours"* is one sentence
 * and — until this file — four screens. The construction dossier names it as
 * the field tool that beats a clipboard, and it is the first thing somebody
 * standing on a site touches in this pack.
 *
 * ── TWO ACTIONS, AND THEY ARE NOT THE SAME KIND OF SAFE ─────────────────────
 *
 * `jobs.log` writes a line into a day's report and, when the sentence says so,
 * a crew line. It is READ BACK AND CONFIRMED (ADR 0050 default): a line landed
 * on the wrong job is visible only to somebody who opens that other job, which
 * fails the first of the three tests — visible, to this person, on a screen
 * they already look at.
 *
 * `jobs.punch` raises a punch item, which is a WORK item linked to the project
 * — the same seam `work.add` writes through — and it RECORDS ITSELF the way
 * `work.add` does: it appears on a list, it is one press to remove, and it
 * moves no quantity.
 *
 * ── WHICH JOB ──────────────────────────────────────────────────────────────
 *
 * Searched, never listed ([ADR 0052](../../../../docs/decisions/0052-the-model-says-the-words-and-the-pack-goes-looking.md)):
 * a builder with forty open jobs cannot have them written into every sentence.
 * Number first ("24-108"), then the name, then the address, then a word in
 * common, then everything open — a shortlist is a question and an empty
 * result is a dead end. Never edit distance: "Lot 12" is one character from
 * "Lot 13", and choosing between them on distance is how a day gets logged on
 * the wrong house.
 *
 * Only projects that are still going are offered. A completed job is not
 * something anybody is standing on saying what happened today.
 */

const text = (v: TellValues[string]): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

const num = (v: TellValues[string]): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

const OPEN_STATUSES = new Set(["planned", "active", "on_hold"]);

async function openProjects(tx: Tx, tenantId: string): Promise<OpenProject[]> {
  const rows = await listProjects(tx, tenantId);
  return rows
    .filter((p) => OPEN_STATUSES.has(p.status))
    .map((p) => ({
      value: p.id,
      number: p.number,
      name: p.name,
      address: p.address,
      deliveryMethod: p.deliveryMethod,
    }));
}

/** This pack's refusals, and Work's for the punch item, in their own words. */
function refusal(err: unknown): unknown {
  if (err instanceof JobsError || err instanceof WorkError) return new TellRefusal(err.message);
  return err;
}

export const jobsTellSource: TellSource = {
  slug: "jobs",
  moduleSlug: PACK,
  label: "Jobs",
  revalidate: ["/dashboard/m/jobs", "/dashboard/m/work", "/dashboard/today"],

  async actions(tx: Tx, ctx: TellCtx): Promise<TellAction[]> {
    const projects = await openProjects(tx, ctx.tenantId);
    // Nothing to log against, nothing offered — an action whose every choice
    // is empty is one the model can pick and nobody can resolve.
    if (projects.length === 0) return [];

    const projectField = (hint: string) => ({
      key: "project",
      label: "Which job",
      kind: "choice" as const,
      required: true,
      hint,
      find: async (_tx: Tx, _ctx: TellCtx, said: string) => findProjects(projects, said),
    });
    const nameOf = (value: TellValues[string]) =>
      projects.find((p) => p.value === value)?.name ?? "the job";

    return [
      {
        slug: "jobs.log",
        title: "Logged on site",
        about:
          "What happened on a job site, for its daily log: work done, who was there, weather, a delay. Examples: “poured the garage slab at Oak Row, four guys, six hours”, “framers didn't show at 24-108, rained out by noon”. A report of the day — not something that still needs doing, which is a punch item.",
        fields: [
          projectField(
            "The job, in the person's own words — its number, name, street or client.",
          ),
          {
            key: "notes",
            label: "What happened",
            kind: "text",
            required: true,
            hint: "The work or the event as one line of the report: “Poured the garage slab.” Without the job's name or the headcount.",
          },
          {
            key: "trade",
            label: "Crew",
            kind: "text",
            hint: "The trade or company of the people, when said: “framers”. Else empty.",
          },
          {
            key: "workers",
            label: "How many",
            kind: "number",
            hint: "How many people, when said: “four guys” is 4. Else empty.",
          },
          {
            key: "hours",
            label: "Hours each",
            kind: "number",
            hint: "Hours each, when said: “six hours” is 6, “six and a half” is 6.5. Else empty.",
          },
          {
            key: "weather",
            label: "Weather",
            kind: "text",
            hint: "Only when mentioned: “rained out by noon”. Usually empty.",
          },
          {
            key: "date",
            label: "Which day",
            kind: "date",
            defaultToday: true,
            hint: "Today unless the sentence says yesterday or names a day.",
          },
        ],
        async record(tx, ctx, values) {
          const projectId = text(values.project);
          if (!projectId) throw new TellRefusal("say which job");
          const notes = text(values.notes);
          if (!notes) throw new TellRefusal("say what happened");
          const day = text(values.date) ?? ctx.today;
          const workers = num(values.workers);
          const hours = num(values.hours);
          const trade = text(values.trade);
          const jobsCtx = { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role };
          try {
            const log = await saveDailyLog(tx, jobsCtx, {
              projectId,
              logDate: day,
              appendNotes: notes,
              ...(text(values.weather) ? { weather: text(values.weather)! } : {}),
            });
            // A headcount with no trade is still a crew — "own crew" is what
            // a builder means by "four guys" with no other word.
            if (workers !== null || hours !== null) {
              await addCrew(tx, jobsCtx, log.id, {
                trade: trade ?? "Crew",
                workers: Math.max(0, Math.round(workers ?? 0)),
                hoursTenths: Math.max(0, Math.round((hours ?? 0) * 10)),
              });
            }
          } catch (err) {
            throw refusal(err);
          }
          const crew =
            workers !== null || hours !== null
              ? ` — ${trade ?? "crew"}${workers !== null ? ` ${workers}` : ""}${
                  hours !== null ? ` × ${tenthsToHours(Math.round(hours * 10))}h` : ""
                }`
              : "";
          return { summary: `${nameOf(projectId)}: ${notes}${crew}` };
        },
      },
      {
        slug: "jobs.punch",
        title: "Punch item",
        about:
          "Something on a job that still needs fixing or finishing — a punch list item, a defect, a callback. Examples: “punch item at Oak Row: touch up the paint in the master bath”, “the Millers want the porch rail fixed”. Only when a JOB is named; otherwise it is the plain work list.",
        // ADR 0050: on a list, one press to remove, moves nothing — the same
        // three tests `work.add` passes.
        unattended: true,
        fields: [
          projectField("The job, in the person's own words — its number, name, street or client."),
          {
            key: "title",
            label: "What needs doing",
            kind: "text",
            required: true,
            hint: "The item itself, in as few words as the sentence allows: “Touch up paint in master bath”.",
          },
          {
            key: "due",
            label: "By when",
            kind: "date",
            hint: "Only when the sentence says when. Do NOT fill this in with today.",
          },
        ],
        async record(tx, ctx, values) {
          const projectId = text(values.project);
          if (!projectId) throw new TellRefusal("say which job");
          const title = text(values.title);
          if (!title) throw new TellRefusal("say what needs doing");
          try {
            await addPunchItem(
              tx,
              { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role },
              projectId,
              { title, dueOn: text(values.due) },
            );
          } catch (err) {
            throw refusal(err);
          }
          const by = text(values.due);
          return { summary: `${nameOf(projectId)}: ${title}${by ? ` — due ${by}` : ""}` };
        },
      },
    ];
  },
};
