import { z } from "zod";
import { addDays } from "../core/timeline";

/**
 * The SHAPE of a note extraction: limits, schemas, and the two pure functions
 * that turn a model's tool call into something reviewable.
 *
 * DELIBERATELY NOT `server-only`. The review dialog is a client component and
 * needs `NOTE_MAX_CHARS` to bound its textarea — importing that from the
 * server module pulled the Anthropic SDK and drizzle toward the browser
 * bundle, which is exactly what `server-only` exists to stop. Same split the
 * interview uses: `interview-prompt`/`interview-validate` are shared, and
 * `interview.ts` holds the network and database work.
 *
 * Everything here is pure — no database, no network, no secrets. The server
 * half lives in `extract-note.ts`.
 *
 * WHAT THIS IS NOT: it does not write anything. `extractNote` returns a
 * PROPOSAL. Every item reaches the database only after somebody has seen it,
 * edited what is wrong and pressed save — the actions in `note-actions.ts` take
 * the reviewed list, not the model's output. That boundary is the whole design:
 * an extractor that wrote directly would be an automation nobody asked for,
 * silently creating follow-ups that then route into somebody's morning digest.
 *
 * `validateExtraction` is the Zod boundary of the house AI pattern (see
 * `src/modules/accounting/ai/extract.ts`): a malformed tool call is a refusal,
 * never a half-parsed proposal shown as if it were the answer.
 */

/** A note longer than this is a document, and belongs in Documents. */
export const NOTE_MAX_CHARS = 8_000;

/* -- What comes back ------------------------------------------------------ */

/**
 * Dates arrive as an OFFSET IN DAYS, never as a date string.
 *
 * The model does not know what day it is for this business, and asking it
 * would invite it to guess. The caller resolves the offset against the
 * tenant's today (`tenants.timezone`, drizzle/0086), so "follow up Friday"
 * lands on the business's Friday rather than the server's. See
 * docs/modules/timezone.md.
 */
const proposedTaskSchema = z.object({
  title: z.string().min(1).max(200),
  dueInDays: z.number().int().min(0).max(365).nullable(),
  assigneeHint: z.string().max(120).nullable(),
});

/**
 * `email` is deliberately NOT a kind — `crm_activity_kind` is note/call/meeting
 * (drizzle: crmActivityKind). Correspondence lives in the Mail module and
 * attaches to a record through `mail_links`, so logging an email as a CRM
 * activity would duplicate a thread that is already filed against the record.
 * Email-shaped notes come back as `note`.
 */
const proposedActivitySchema = z.object({
  kind: z.enum(["call", "meeting", "note"]),
  summary: z.string().min(1).max(2_000),
});

const extractionSchema = z.object({
  activities: z.array(proposedActivitySchema).max(10),
  tasks: z.array(proposedTaskSchema).max(10),
});

export type ProposedTask = z.infer<typeof proposedTaskSchema>;
export type ProposedActivity = z.infer<typeof proposedActivitySchema>;
export type Extraction = z.infer<typeof extractionSchema>;

/** A proposal with dates already resolved into the tenant's calendar. */
export interface ResolvedProposal {
  activities: ProposedActivity[];
  tasks: Array<{
    title: string;
    dueOn: string | null;
    assigneeClerkUserId: string | null;
    assigneeHint: string | null;
  }>;
}

/* -- Validate + resolve --------------------------------------------------- */

/**
 * Zod at the boundary. A tool call that does not fit the schema is a refusal,
 * not something to partially salvage — a half-parsed proposal shown as if it
 * were the model's answer is worse than saying it failed.
 */
export function validateExtraction(raw: unknown): Extraction | null {
  const parsed = extractionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Resolve day offsets against the tenant's today, and match assignee hints to
 * real people.
 *
 * The hint is matched case-insensitively against names the caller can already
 * see; anything that does not match stays `null` and keeps the raw hint, so the
 * reviewer sees "the note said Dave, we could not place him" rather than a
 * silently unassigned task. An unmatched hint is never a guess.
 */
export function resolveProposal(
  extraction: Extraction,
  today: string,
  members: ReadonlyArray<{ clerkUserId: string; label: string }>,
): ResolvedProposal {
  const byName = new Map(members.map((m) => [m.label.trim().toLowerCase(), m]));

  return {
    activities: extraction.activities,
    tasks: extraction.tasks.map((t) => {
      const hint = t.assigneeHint?.trim() ?? "";
      const exact = hint ? byName.get(hint.toLowerCase()) : undefined;
      // First-name match, because notes say "Dave will call" and the roster
      // says "Dave Okafor". Only when exactly one person matches — two Daves
      // means we genuinely do not know which, and guessing would put the work
      // on the wrong person's morning digest.
      const firstNameMatches = hint
        ? members.filter(
            (m) => m.label.trim().split(/\s+/)[0]?.toLowerCase() === hint.toLowerCase(),
          )
        : [];
      const matched =
        exact ?? (firstNameMatches.length === 1 ? firstNameMatches[0] : undefined);

      return {
        title: t.title,
        dueOn: t.dueInDays === null ? null : addDays(today, t.dueInDays),
        assigneeClerkUserId: matched?.clerkUserId ?? null,
        assigneeHint: matched ? null : hint || null,
      };
    }),
  };
}
