import type { Tx } from "@/db";

/**
 * Linkable business records — the contract shared by every surface that says
 * "attach this to something".
 *
 * THIS FILE IMPORTS NOTHING FROM `src/modules/**`, AND MUST NOT. Same one-way
 * graph as `mail-extensions/types.ts` and `attention-sources/types.ts`:
 *
 *     src/modules/<slug>/…             ──imports──▶  types.ts   (this file)
 *     src/lib/entity-links/registry.ts ──imports──▶  every module's types
 *     a HOST module (mail, scheduling) ──imports──▶  registry.ts
 *
 * ── WHY THIS EXISTS SEPARATELY FROM MAIL ─────────────────────────────────────
 *
 * Mail declared this idea first, so `MailEntityType` owned it: nine
 * implementations across Accounting, CRM and Documents, all of them describing
 * "a record you can search for and then point at". Scheduling wants exactly the
 * same nine — an event is attached to an invoice for the same reason a thread
 * is.
 *
 * The alternative was a parallel contract and nine second implementations to
 * keep in sync, which is the duplication ADR 0004 exists to prevent. So the
 * GENERIC half moved here and `MailEntityType` now extends it with the parts
 * that really are mail's: template placeholders. Nothing about the existing
 * implementations changed; only the type they satisfy did.
 *
 * ── THE RULE THAT IS SECURITY, NOT STYLE ─────────────────────────────────────
 *
 * `search` and `resolve` take the CALLER'S `tx`. They do not open their own
 * transaction, and never call `withSystem`. The caller has already established
 * the RLS context from a `requireTenant()` result, so what a type can find is
 * exactly what the person asking may see — invariant S12 as a function
 * signature. A type that opened its own scope could hand a host a row RLS had
 * already refused.
 *
 * Every hook is optional to fail: nothing may throw. A broken contributor costs
 * its own rows in a picker, never the page around it.
 */

/**
 * What a contributor is told about the caller.
 *
 * Deliberately small — the ids and the role, all from `requireTenant()`.
 * Notably absent is anything usable to broaden a query: no database handle, no
 * session, no token. It gets the caller's `tx`, and that tx is already scoped.
 */
export interface EntityLinkCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

/** Enough to write a link row. */
export interface LinkableEntityRef {
  /** Matches the `entity_type` format check: ^[a-z][a-z0-9_]{0,62}$ */
  entityType: string;
  entityId: string;
}

/**
 * One thing something can be attached to, as a picker needs to show it.
 *
 * Presentation strings come from the contributor because only it knows what an
 * invoice is called. A host renders them and never parses them.
 */
export interface LinkableEntity extends LinkableEntityRef {
  /** "Invoice INV-1042" — the primary line, already formatted. */
  label: string;
  /** "Acme Builders · due 2026-08-01". Optional second line. */
  sublabel?: string;
  /** Where clicking it goes. Omitted when the entity has no page of its own. */
  href?: string;
}

/**
 * A kind of record that can be linked to. One per entity type, not one per
 * module — Accounting contributes four.
 */
export interface LinkableEntityType {
  /**
   * Written verbatim into a link table's `entity_type`, which carries no
   * whitelist on purpose: registering a new type needs no migration to core.
   * The format CHECK is the only constraint, so keep it lowercase and
   * underscore-separated.
   */
  type: string;
  /** Singular, for the picker: "Invoice". */
  label: string;
  /** Plural, for headings: "Invoices". */
  pluralLabel: string;
  /** lucide icon name. A string, so it stays serializable across the boundary. */
  icon: string;
  /**
   * Find candidates for an "Attach to…" picker.
   *
   * `query` is raw user input and must be treated as such — bind it, never
   * interpolate it. Returning fewer than `limit` is fine; more is truncated by
   * the caller.
   */
  search(
    tx: Tx,
    ctx: EntityLinkCtx,
    query: string,
    limit: number,
  ): Promise<LinkableEntity[]>;
  /**
   * Turn stored ids back into displayable entities — BATCHED, one call for
   * every id of this type on the page.
   *
   * Batched because the alternative is N+1 queries behind a list. Ids that no
   * longer resolve (deleted, or hidden by RLS) are simply absent from the
   * result; a caller renders those as a dangling link rather than an error.
   */
  resolve(
    tx: Tx,
    ctx: EntityLinkCtx,
    ids: readonly string[],
  ): Promise<LinkableEntity[]>;
}

/** A module's contribution of linkable types. */
export interface EntityLinkProvider {
  /**
   * Written into a link row's `extension_slug`, so an uninstalled layer's links
   * can be ignored rather than repaired. Format: ^[a-z][a-z0-9_-]{0,62}$
   */
  slug: string;
  /**
   * The module that must be enabled for these types to appear.
   * `requireModuleEnabled` is an entitlement check, not a security boundary
   * (security.md §7) — this is about what a tenant has bought. RLS decides what
   * they may read.
   */
  moduleSlug: string;
  /** Human name, for a picker's section headings. */
  name: string;
  entityTypes: LinkableEntityType[];
}
