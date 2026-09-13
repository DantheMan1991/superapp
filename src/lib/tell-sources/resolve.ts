import "server-only";
import type { Tx } from "@/db";
import { withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { getActiveModules } from "@/lib/modules";
import { callTellModel, claimCooldown, type TellModel } from "./model";
import { resolveFound } from "./find";
import { tellSources } from "./registry";
import {
  checkEntry,
  resolveEntries,
  TELL_MAX_ENTRIES,
  validateProposal,
  type TellCard,
} from "./shape";
import {
  TellRefusal,
  type TellAction,
  type TellCtx,
  type TellField,
  type TellPreview,
  type TellSource,
  type TellValues,
} from "./types";

/**
 * Running the sources: what this tenant can be told, what one sentence says,
 * and recording what a person confirmed.
 *
 * TWO HALVES, and the split is the safety property (ADR 0036's rule, applied
 * to events rather than rows). `proposeTold` writes NOTHING. `recordTold`
 * writes what the person confirmed, and it never sees the model's output: its
 * input is the confirmed cards, checked against the actions as they stand NOW
 * and then handed to the pack's own verb.
 */

export type TellErrorCode =
  | "NOTHING_ENABLED"
  | "NOTHING_SAID"
  | "TOO_LONG"
  | "COOLDOWN"
  | "NO_RESULT"
  | "NOTHING_KEPT"
  | "TOO_MANY"
  | "CARD";

export class TellError extends Error {
  constructor(
    public readonly code: TellErrorCode,
    message: string,
    public readonly detail: { index?: number; title?: string } = {},
  ) {
    super(message);
    this.name = "TellError";
  }
}

/** The words the box shows. Static, except a refusal, which names the card. */
export function friendlyTellError(err: unknown): string {
  if (err instanceof TellError) {
    switch (err.code) {
      case "NOTHING_ENABLED":
        return "There is nothing here to tell yet.";
      case "NOTHING_SAID":
        return "Say what happened.";
      case "TOO_LONG":
        return "That is a lot for one go — say one thing at a time.";
      case "COOLDOWN":
        return "Give it a moment, then try again.";
      case "NO_RESULT":
        return "It could not read that. Try saying it more plainly.";
      case "NOTHING_KEPT":
        return "Nothing is ticked.";
      case "TOO_MANY":
        return `${TELL_MAX_ENTRIES} things at most in one go.`;
      case "CARD": {
        const where = err.detail.title ? `${err.detail.title}: ` : "";
        return `${where}${err.message}`;
      }
    }
  }
  console.error("tell failed", err);
  return "Something went wrong. Nothing was recorded.";
}

/* -- What this tenant can be told ----------------------------------------- */

interface Loaded {
  source: TellSource;
  action: TellAction;
}

async function loadActions(tx: Tx, ctx: TellCtx, enabled: Set<string>): Promise<Loaded[]> {
  const out: Loaded[] = [];
  for (const source of tellSources) {
    if (!enabled.has(source.moduleSlug)) continue;
    for (const action of await source.actions(tx, ctx)) {
      out.push({ source, action });
    }
  }
  return out;
}

/** The module slugs switched on for this tenant. */
async function enabledModules(tenantId: string): Promise<Set<string>> {
  return new Set((await getActiveModules(tenantId)).map((m) => m.module.id));
}

/* -- Propose -------------------------------------------------------------- */

/**
 * A field as the BOX sees it — everything except the code.
 *
 * `TellField.find` is a FUNCTION, and the box is a client component: handing
 * it one is "Functions cannot be passed directly to Client Components", which
 * is a runtime error and nothing else catches it. `tsc` is happy, the build is
 * happy, three thousand tests are happy, and the first sentence anybody types
 * fails. Found by driving it.
 *
 * Picked field by field rather than deleted, so the NEXT function added to the
 * contract cannot leak through the same hole by default.
 */
function forTheBox(field: TellField) {
  return {
    key: field.key,
    label: field.label,
    kind: field.kind,
    required: field.required,
    hint: field.hint,
    choices: field.choices,
    defaultToday: field.defaultToday,
    /**
     * This one is SEARCHED, so it has no list and must not be drawn as a
     * dropdown — an empty one is what the founder was shown, with no way out
     * of it. A boolean rather than the function itself: functions cannot cross
     * into a client component (see the header).
     */
    searched: field.find !== undefined,
  };
}

export interface TellProposal {
  cards: TellCard[];
  /** Every action the tenant has, so the box can draw and re-check a card. */
  actions: Array<{
    slug: string;
    title: string;
    label: string;
    fields: ReturnType<typeof forTheBox>[];
    /** ADR 0050 — the box records a complete card of this one without asking. */
    unattended: boolean;
    /** ADR 0054 §2 — the box asks what this card will do before recording it. */
    hasPreview: boolean;
  }>;
}

export async function proposeTold(
  ctx: TellCtx,
  sentence: string,
  model: TellModel = callTellModel,
): Promise<TellProposal> {
  const said = sentence.trim();
  if (said === "") throw new TellError("NOTHING_SAID", "empty");

  const enabled = await enabledModules(ctx.tenantId);
  const loaded = await withTenant(ctx.tenantId, (tx) => loadActions(tx, ctx, enabled), {
    role: ctx.role,
    userId: ctx.userId,
  });
  if (loaded.length === 0) throw new TellError("NOTHING_ENABLED", "no sources");

  if (!claimCooldown(ctx.tenantId, ctx.userId)) {
    throw new TellError("COOLDOWN", "within the window");
  }

  const actions = loaded.map((l) => l.action);
  const raw = await model({ sentence: said, actions, today: ctx.today });
  const entries = validateProposal(raw);
  if (!entries) throw new TellError("NO_RESULT", "schema mismatch");

  /*
   * SECOND PASS, AND IT NEEDS A TRANSACTION. `resolveEntries` is pure and does
   * everything that can be decided from the sentence alone; a `find` field can
   * only be settled by going and looking at this tenant's rows, which is what
   * removes the ceiling and what lets "the cows" find the cattle (`find.ts`).
   *
   * Its own `withTenant` rather than the one above, because the model call sits
   * between them and a transaction held open across seconds of network latency
   * is how a connection pool is exhausted.
   */
  const cards = await withTenant(
    ctx.tenantId,
    (tx) => resolveFound(tx, ctx, resolveEntries(entries, actions, ctx.today), actions),
    { role: ctx.role, userId: ctx.userId },
  );

  return {
    cards,
    actions: loaded.map((l) => ({
      slug: l.action.slug,
      title: l.action.title,
      label: l.source.label,
      fields: l.action.fields.map(forTheBox),
      unattended: l.action.unattended === true,
      hasPreview: typeof l.action.preview === "function",
    })),
  };
}

/* -- What a card will do, asked again every time it changes ---------------- */

/**
 * The consequence of ONE card, as its own action works it out.
 *
 * Its own call rather than part of the proposal, because a person edits a card
 * and a preview computed before the edit is a confident statement about a
 * number that has since changed. The box asks again whenever the values move
 * and shows nothing at all in the gap — **a stale preview is worse than none**,
 * since the whole point is to be the thing somebody trusts instead of reading
 * the fields.
 *
 * A preview that throws is not an error worth interrupting anybody with: the
 * card is still correct, the button still works, and the pack's own verb is
 * still the thing that refuses. It comes back as `null` and the box says it
 * could not work it out.
 */
export async function previewTold(
  ctx: TellCtx,
  actionSlug: string,
  values: TellValues,
): Promise<TellPreview | null> {
  const enabled = await enabledModules(ctx.tenantId);
  return withTenant(
    ctx.tenantId,
    async (tx) => {
      const loaded = await loadActions(tx, ctx, enabled);
      const found = loaded.find((l) => l.action.slug === actionSlug);
      if (!found?.action.preview) return null;

      // Only the action's own declared fields, the way `recordTold` does it —
      // so a preview cannot be handed a key the action never asked for.
      const only: TellValues = {};
      for (const f of found.action.fields) only[f.key] = values[f.key] ?? null;
      if (checkEntry(only, found.action)) return null;

      return found.action.preview(tx, ctx, only);
    },
    { role: ctx.role, userId: ctx.userId },
  );
}

/* -- Record what was confirmed -------------------------------------------- */

export interface ConfirmedEntry {
  actionSlug: string;
  values: TellValues;
}

export interface TellRecordedAll {
  /** One line each, in the order they were recorded. */
  summaries: string[];
  /** The paths every pack that recorded something asked to have revalidated. */
  touched: string[];
}

/**
 * Checked on its own terms, NOT trusted because it came from the proposal.
 * The person has edited it, and this function has no way to know which parts
 * are theirs — so all of it is ordinary input, checked against the actions as
 * they stand NOW (the choices are read again) and then given to the pack's
 * verb, which refuses what it refuses.
 *
 * ONE TRANSACTION, ALL OR NONE. Two things told in one sentence happened
 * together, and half of them landing is a worse state to be in than none.
 */
export async function recordTold(
  ctx: TellCtx,
  entries: ConfirmedEntry[],
): Promise<TellRecordedAll> {
  if (entries.length === 0) throw new TellError("NOTHING_KEPT", "no cards");
  if (entries.length > TELL_MAX_ENTRIES) {
    throw new TellError("TOO_MANY", `${entries.length}`);
  }
  const enabled = await enabledModules(ctx.tenantId);

  const { summaries, touched } = await withTenant(
    ctx.tenantId,
    async (tx) => {
      const loaded = await loadActions(tx, ctx, enabled);
      const bySlug = new Map(loaded.map((l) => [l.action.slug, l]));

      // Every card checked before any is recorded, so a refusal on the last
      // one does not leave the first three in the books.
      const ready = entries.map((entry, index) => {
        const found = bySlug.get(entry.actionSlug);
        if (!found) {
          throw new TellError("CARD", "That is not something you can record here.", {
            index,
          });
        }
        const values: TellValues = {};
        for (const f of found.action.fields) values[f.key] = entry.values[f.key] ?? null;
        const problem = checkEntry(values, found.action);
        if (problem) {
          throw new TellError("CARD", problem, { index, title: found.action.title });
        }
        return { found, values, index };
      });

      const summaries: string[] = [];
      const touched = new Set<string>();
      for (const { found, values, index } of ready) {
        try {
          const done = await found.action.record(tx, ctx, values);
          summaries.push(done.summary);
          for (const path of found.source.revalidate) touched.add(path);
        } catch (err) {
          if (err instanceof TellRefusal) {
            throw new TellError("CARD", err.message, {
              index,
              title: found.action.title,
            });
          }
          throw err;
        }
      }

      // Audited as counts and action slugs — never the sentence, which is the
      // tenant's and says where somebody was standing (S9).
      await logAuditInTx(tx, {
        action: "tell.recorded",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "tell",
        targetId: null,
        meta: { entries: ready.map((r) => r.found.action.slug) },
      });
      return { summaries, touched: [...touched] };
    },
    { role: ctx.role, userId: ctx.userId },
  );

  return { summaries, touched };
}
