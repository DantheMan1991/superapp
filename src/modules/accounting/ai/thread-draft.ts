import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
import { listContactPointsFor } from "@/lib/parties/contacts";
import type {
  DraftableThread,
  DraftedRecord,
  EntityLinkCtx,
} from "@/lib/mail-extensions/types";
import { LedgerError } from "../core";
import { todayInTimezone } from "../lib/money";
import {
  buildThreadDraftUserTurn,
  threadDraftSystemPrompt,
  threadDraftTool,
  type ThreadDraftKind,
  type ThreadDraftParty,
} from "./thread-draft-prompt";
import { validateThreadDraft } from "./thread-draft-validate";

/**
 * Drafting an invoice or a bill from a mail conversation.
 *
 * Same engine shape as the module's other four (`suggest`, `extract`,
 * `bill-code`, `narrative`): a pure prompt seam, a pure validate seam, an
 * injectable model call, forced `tool_choice`, and a per-tool cooldown. What
 * it adds is the citation check in `thread-draft-validate.ts`, which is the
 * only reason a human can trust the output quickly.
 *
 * THINKING IS ON. Unlike the older call sites — which pin it off to preserve
 * the behaviour they had on `claude-opus-4-8` — this one is new, and deciding
 * whether a conversation contains an actual agreement is exactly the kind of
 * reasoning `src/lib/claude.ts` says to give room to. `MAX_TOKENS` is sized
 * for thinking plus the tool call, not just the tool call.
 */

const COOLDOWN_MS = 15_000;
const MAX_TOKENS = 8000;
/** Parties offered to the model for matching. Enough for a real address book. */
const PARTY_LIMIT = 200;

export interface ThreadDraftDeps {
  /** Injectable so the engine is testable without the network. */
  callModel?: (args: {
    system: string;
    user: string;
    tool: ReturnType<typeof threadDraftTool>;
  }) => Promise<unknown>;
}

async function defaultCallModel(args: {
  system: string;
  user: string;
  tool: ReturnType<typeof threadDraftTool>;
}): Promise<unknown> {
  const response = await getClaude().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    // Adaptive, deliberately — see the file header.
    thinking: { type: "adaptive" },
    system: args.system,
    tools: [args.tool],
    // Forced: the only acceptable answer is the structured one.
    tool_choice: { type: "tool", name: args.tool.name },
    messages: [{ role: "user", content: args.user }],
  });
  const block = response.content.find((b) => b.type === "tool_use");
  return block && block.type === "tool_use" ? block.input : null;
}

/**
 * The parties this kind of record could be with, and how to reach them.
 *
 * Data minimisation (P15): the model sees names and addresses so it can match
 * the correspondent, and nothing else about them — no balances, no history, no
 * notes. Read through the CALLER'S tx, so an extension can only offer parties
 * the person asking may already see (S12).
 */
async function loadParties(
  tx: Tx,
  tenantId: string,
  kind: ThreadDraftKind,
): Promise<ThreadDraftParty[]> {
  const rows =
    kind === "invoice"
      ? await tx
          .select({
            id: schema.customers.id,
            name: schema.customers.name,
            partyId: schema.customers.partyId,
          })
          .from(schema.customers)
          .where(
            and(
              eq(schema.customers.tenantId, tenantId),
              eq(schema.customers.isActive, true),
            ),
          )
          .limit(PARTY_LIMIT)
      : await tx
          .select({
            id: schema.vendors.id,
            name: schema.vendors.name,
            partyId: schema.vendors.partyId,
          })
          .from(schema.vendors)
          .where(
            and(
              eq(schema.vendors.tenantId, tenantId),
              eq(schema.vendors.isActive, true),
            ),
          )
          .limit(PARTY_LIMIT);

  if (rows.length === 0) return [];

  const contacts = await listContactPointsFor(
    tx,
    tenantId,
    rows.map((r) => r.partyId),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    emails: (contacts.get(r.partyId) ?? [])
      .filter((c) => c.kind === "email")
      .map((c) => c.value),
  }));
}

/** Claim the cooldown slot, so concurrent presses serialize. */
async function claimCooldown(tx: Tx, tenantId: string): Promise<void> {
  const settings = await tx.query.accountingSettings.findFirst({
    where: eq(schema.accountingSettings.tenantId, tenantId),
  });
  if (!settings) {
    throw new LedgerError("SETTINGS_MISSING", "accounting_settings row missing");
  }
  if (settings.aiLastThreadDraftAt) {
    const age = Date.now() - settings.aiLastThreadDraftAt.getTime();
    if (age < COOLDOWN_MS) {
      throw new LedgerError("AI_COOLDOWN", `last draft ${age}ms ago`);
    }
  }
  await tx
    .update(schema.accountingSettings)
    .set({ aiLastThreadDraftAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.accountingSettings.tenantId, tenantId));
}

export async function draftFromThread(
  tx: Tx,
  ctx: EntityLinkCtx,
  kind: ThreadDraftKind,
  thread: DraftableThread,
  deps: ThreadDraftDeps = {},
): Promise<DraftedRecord | null> {
  // An expert (outside accountant) reads the books; they do not raise records.
  if (ctx.role === "expert") {
    throw new LedgerError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  if (thread.messages.length === 0) return null;

  await claimCooldown(tx, ctx.tenantId);

  const tenant = await tx.query.tenants.findFirst({
    where: eq(schema.tenants.id, ctx.tenantId),
    columns: { timezone: true },
  });
  const today = todayInTimezone(tenant?.timezone ?? "America/New_York");

  const parties = await loadParties(tx, ctx.tenantId, kind);
  const tool = threadDraftTool(kind);
  const raw = await (deps.callModel ?? defaultCallModel)({
    system: threadDraftSystemPrompt(kind),
    user: buildThreadDraftUserTurn(thread, parties, today),
    tool,
  });

  const { record } = validateThreadDraft(
    raw,
    kind,
    thread,
    new Set(parties.map((p) => p.id)),
    today,
  );
  return record;
}

/**
 * Resolve the party a reviewed record names, for the accept path.
 *
 * Re-checked server-side rather than trusted: the record has been through a
 * browser, so its `partyId` is a claim about a row, not a row.
 */
export async function resolveDraftParty(
  tx: Tx,
  tenantId: string,
  kind: ThreadDraftKind,
  partyId: string | null,
): Promise<{ id: string } | null> {
  if (!partyId) return null;
  const table = kind === "invoice" ? schema.customers : schema.vendors;
  const rows = await tx
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.tenantId, tenantId),
        inArray(table.id, [partyId]),
        eq(table.isActive, true),
      ),
    );
  return rows[0] ?? null;
}
