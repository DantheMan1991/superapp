/**
 * The discovery copilot's prompt — PURE, no database, no model call.
 *
 * **THIS FILE IS WHY SLICE 7d IS NOT A MOVE.** The prompt this replaces
 * (`src/lib/discovery.ts`, superadmin-only) named the business it worked for,
 * described its four pricing tiers and quoted their dollar figures — all of it
 * true of exactly one company. A pack that carried that would know which
 * business it was running inside, which is the boundary
 * [ADR 0004](../../../../docs/decisions/0004-capability-packs-and-industry-profiles.md)
 * draws and the one this whole layer exists to keep.
 *
 * So the SKELETON stays here — it is true of any services business doing
 * discovery: turn raw notes into findings, do the ROI arithmetic out loud,
 * name the next questions, flag anything license-gated, and say plainly when a
 * prospect is a bad fit. The FACTS come from the tenant: its name, what it
 * does, what it sells, and what a client would otherwise do.
 *
 * Those facts are Layer 3 — one company's tailoring — so they live in
 * `tenant_modules.config`, not in the profile. An agency's price list is its
 * own; a second agency installing the same profile must not inherit the
 * first's. `docs/extension-model.md` §5 calls that the Layer 3 rule, and this
 * is its first real reader.
 *
 * **IT DEGRADES HONESTLY.** A business that has told us nothing still gets a
 * working copilot — one that is told it has not been briefed and must ask
 * instead of inventing. That matters more than it sounds: a prompt that
 * invents a price list is worse than one that admits it has none.
 */

export interface DiscoveryBusiness {
  /** The tenant's own name. Never editable here — it is the workspace's. */
  name: string;
  /** What this business does for its clients, in a sentence or two. */
  what: string;
  /** What it sells and what that costs, in its own words. */
  offering: string;
  /** What a client would do instead of buying — the thing to price against. */
  alternative: string;
  /** What a client's own hour is worth, for the ROI arithmetic. */
  clientHourlyRate: string;
}

/** The keys a tenant fills in. `name` is not among them. */
export type DiscoveryFacts = Omit<DiscoveryBusiness, "name">;

export const EMPTY_FACTS: DiscoveryFacts = {
  what: "",
  offering: "",
  alternative: "",
  clientHourlyRate: "",
};

/** True when the business has told the copilot nothing at all. */
export function isBriefed(business: DiscoveryBusiness): boolean {
  return (
    business.what.trim() !== "" ||
    business.offering.trim() !== "" ||
    business.alternative.trim() !== ""
  );
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Read the business's own facts out of `tenant_modules.config`.
 *
 * TOTAL and tolerant, like every other config reader in the packs: the column
 * is jsonb with no shape constraint, so anything unreadable becomes an empty
 * field and the prompt says it has not been briefed. Nothing throws.
 */
export function discoveryFactsFrom(config: unknown): DiscoveryFacts {
  const root =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : null;
  const raw = root?.discovery;
  const facts =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  if (!facts) return EMPTY_FACTS;
  return {
    what: text(facts.what, 2000),
    offering: text(facts.offering, 5000),
    alternative: text(facts.alternative, 2000),
    clientHourlyRate: text(facts.clientHourlyRate, 100),
  };
}

export function discoveryBusiness(name: string, facts: DiscoveryFacts): DiscoveryBusiness {
  return { name: name.trim() || "this business", ...facts };
}

/**
 * The system prompt. Static for a given business, so it is worth caching as a
 * prefix — the caller marks it `ephemeral`, as the superadmin version did.
 */
export function discoverySystemPrompt(b: DiscoveryBusiness): string {
  const briefed = isBriefed(b);
  const rate = b.clientHourlyRate.trim();

  const about = briefed
    ? [
        b.what ? `What ${b.name} does for its clients:\n${b.what}` : null,
        b.offering ? `What ${b.name} sells, and what it costs:\n${b.offering}` : null,
        b.alternative
          ? `What a prospect would otherwise do — the thing to price against:\n${b.alternative}`
          : null,
      ]
        .filter((s): s is string => s !== null)
        .join("\n\n")
    : `NOBODY HAS TOLD YOU WHAT ${b.name.toUpperCase()} SELLS OR WHAT IT CHARGES. Do the diagnosis anyway, but do not invent an offering, a price or a tier. Where the answer depends on what is on sale, say what you would need to know and ask for it.`;

  return `You are the discovery copilot inside ${b.name}'s own workspace. Somebody at ${b.name} is talking to you between — or during — conversations with a prospective client, and bringing you what they learn.

${about}

Your job in this conversation:
1. Turn raw notes ("he said invoicing takes all weekend") into structured findings: the pain, its estimated cost in hours and money, and what would address it.
2. Do the ROI arithmetic out loud and conservatively${rate ? `, valuing the prospect's own time at ${rate} unless you are told otherwise` : `, and state the hourly figure you are valuing the prospect's time at`}. Show the arithmetic and state your assumptions.
3. Tell them the 2–3 highest-value questions to ask next — the ones that would most change the diagnosis or the price.
4. Flag anything license-gated — tax filing, legal advice, anything needing a credential ${b.name} may not hold. Those route to a partner or a referral, never to doing it anyway.
5. Be a skeptic when it is warranted. If a prospect looks like a bad fit — no budget, no volume, wants a one-off custom build — say so plainly. A cheap "no" now beats an expensive one later.

Style: talk like a sharp operator, not a consultant deck. Short paragraphs. Numbers over adjectives. When you estimate, show the arithmetic. Ask for missing facts instead of inventing them.`;
}

/**
 * The instruction that turns the conversation into the two deliverables.
 *
 * The client-facing half is named for the prospect, not for a pricing tier —
 * "Tier 0" meant something in one company's price list and nothing anywhere
 * else.
 */
export function reportInstruction(b: DiscoveryBusiness): string {
  const priced = b.offering.trim() !== "";
  return `Produce the two discovery deliverables from everything in this conversation, as one markdown document with these exact top-level sections:

# Business Health Check — {business name}
The client-facing half. Plain language a busy owner reads in five minutes. Contains: a two-sentence summary of the state of their business office; the 2–4 places they are bleeding time or money, each with the estimated monthly cost (show the arithmetic, conservative); what to fix first and why; and what fixing it would cost them against the alternative of doing nothing or hiring${priced ? `, using ${b.name}'s own prices as given above` : ` — and where a price is needed, say what it depends on rather than inventing one`}. No jargon, no feature lists — outcomes.

# Build Spec — internal
For ${b.name}'s own eyes. Contains: what to set up for this client and in what order; for each piece of work, what it must actually do to solve THIS client's stated problems, specific enough to act on; anything to migrate or integrate; anything license-gated to route to a partner; the questions still open; and a recommendation with one sentence of justification.

Ground every claim in what was actually said in this conversation. Where a number is an assumption, mark it as one. If discovery is too thin to support a section, say what is missing instead of padding it.`;
}

/** First user turn: the facts about THIS engagement, kept out of the cached prefix. */
export function engagementContextMessage(audit: {
  businessName: string;
  industry: string;
  contactName: string | null;
  context: string;
}): string {
  return [
    `Discovery context:`,
    `- Business: ${audit.businessName}`,
    `- Industry: ${audit.industry}`,
    audit.contactName ? `- Contact: ${audit.contactName}` : null,
    audit.context ? `- Intake notes: ${audit.context}` : null,
    ``,
    `Acknowledge briefly and tell me the most important things to find out first for a business like this. I'll bring you what I learn as I talk to them.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
