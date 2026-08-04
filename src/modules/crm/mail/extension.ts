import "server-only";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  LinkableEntity,
  MailContactCandidate,
  MailEntityType,
  MailExtension,
  MailExtensionCtx,
} from "@/lib/mail-extensions/types";
import { formatCents } from "@/lib/money";
import { searchReachableParties } from "@/lib/parties/contacts";

/**
 * What CRM contributes to Mail: the three things a conversation is usually
 * *with*, or *about*.
 *
 * This file imports `@/lib/mail-extensions/types` and nothing else from outside
 * the CRM module. It does not import Mail, and Mail does not import it —
 * `src/lib/mail-extensions/registry.ts` is the only place the two are named
 * together, and eslint.config.mjs enforces that.
 *
 * THE SECURITY PROPERTY, in one sentence: every function below takes the
 * caller's `tx` and adds `tenant_id` to its own WHERE clause, so it can only
 * find rows the person asking could already see. No `withTenant`, no
 * `withSystem`, no widening — invariant S12.
 *
 * WHAT VISIBILITY MEANS HERE, because the three types differ and the difference
 * is deliberate:
 *
 *  - `contact` and `company` read `parties` DIRECTLY. A restricted record's
 *    NAME is visible to staff by design — the identity is shared with
 *    Accounting, where the same person already sees it as a customer — so the
 *    picker offers it exactly as the records list does. Hiding it here and
 *    showing it there would be two answers to one question.
 *
 *  - `deal` reads `crm_deals`, whose RLS policy inherits the record's
 *    visibility. A restricted account's deals therefore do not appear for
 *    staff, and no predicate in this file says so — it falls out of using the
 *    caller's transaction.
 *
 * `contacts` IS NOW IMPLEMENTED, over `party_contact_points`. It could not be
 * until those existed: `MailContactSource` requires an email per suggestion and
 * `parties` deliberately has no email column. This is the hook slice 0's
 * deferral was blocking, and the seam's own header names CRM as the reason it
 * was designed — "so a future CRM contributes its people without Mail knowing
 * it exists".
 *
 * NOTE THE DUPLICATE THIS CREATES, because it is real and accepted rather than
 * missed. A customer's billing address now reaches the composer twice: once
 * from Accounting's `customers.email`, once from the contact point backfilled
 * from it. Both carry a `sublabel` saying where they came from, so the two rows
 * are distinguishable rather than mysterious — and the fix is the CONTRACT
 * slice that retires the accounting columns, not a filter here guessing which
 * copy to suppress.
 */

/** One `%term%` fragment, bound as a parameter — never interpolated. */
function contains(term: string): string {
  // Escape LIKE's own wildcards so a search for "50%" is not "match anything".
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function recordHref(partyId: string): string {
  return `/dashboard/m/crm/records/${partyId}`;
}

/** Shared by the two party-backed types; they differ only by `kind`. */
function partyEntityType(
  type: "contact" | "company",
  kind: "person" | "organization",
  labels: { label: string; pluralLabel: string; icon: string },
): MailEntityType {
  const columns = {
    id: schema.parties.id,
    displayName: schema.parties.displayName,
    legalName: schema.parties.legalName,
    givenName: schema.parties.givenName,
    familyName: schema.parties.familyName,
    isActive: schema.parties.isActive,
  };

  function scoped(tenantId: string, where: ReturnType<typeof and>) {
    return and(
      eq(schema.parties.tenantId, tenantId),
      eq(schema.parties.kind, kind),
      where,
    );
  }

  function present(r: {
    id: string;
    displayName: string;
    legalName: string | null;
    isActive: boolean;
  }): LinkableEntity {
    return {
      entityType: type,
      entityId: r.id,
      label: r.displayName,
      sublabel: [r.legalName, r.isActive ? null : "archived"]
        .filter(Boolean)
        .join(" · "),
      href: recordHref(r.id),
    };
  }

  return {
    type,
    ...labels,

    async search(tx, ctx, query, limit) {
      const like = contains(query);
      const found = await tx
        .select(columns)
        .from(schema.parties)
        .where(
          scoped(
            ctx.tenantId,
            or(
              ilike(schema.parties.displayName, like),
              ilike(schema.parties.legalName, like),
            ),
          ),
        )
        // Active first: an archived record is rarely who somebody means, but
        // hiding it outright would break linking historical correspondence.
        .orderBy(
          desc(schema.parties.isActive),
          sql`lower(${schema.parties.displayName})`,
        )
        .limit(limit);
      return found.map(present);
    },

    async resolve(tx, ctx, ids) {
      if (ids.length === 0) return [];
      const found = await tx
        .select(columns)
        .from(schema.parties)
        .where(scoped(ctx.tenantId, inArray(schema.parties.id, [...ids])));
      return found.map(present);
    },

    /**
     * Chosen for what somebody actually types in a message — the name to open
     * with — rather than for completeness. A field nobody puts in a sentence is
     * a longer list to read past.
     *
     * CUSTOM FIELDS ARE ABSENT AND CANNOT BE ADDED HERE. This array is static
     * because the contract requires the vocabulary to be knowable without
     * reading any data: the template editor lists what may be typed and the
     * save action refuses a typo, both with no record chosen. Per-tenant custom
     * field definitions cannot satisfy that without turning `templateFields`
     * into a function taking `(tx, ctx)` — which reopens an enumeration Mail
     * deliberately closed. That is Mail's decision to make, not CRM's.
     */
    templateFields:
      type === "contact"
        ? [
            { key: "name", label: "Contact name" },
            { key: "first_name", label: "Contact first name" },
            { key: "last_name", label: "Contact last name" },
          ]
        : [
            { key: "name", label: "Company name" },
            { key: "legal_name", label: "Company legal name" },
          ],

    async templateValues(tx, ctx, entityId) {
      const [row] = await tx
        .select(columns)
        .from(schema.parties)
        .where(scoped(ctx.tenantId, eq(schema.parties.id, entityId)));
      // Null for "not yours" and "not there" alike — see the seam's contract.
      // A template therefore cannot be used to probe for records.
      if (!row) return null;

      // Annotated rather than inferred: a ternary over two object literals
      // widens to a union where each branch carries `undefined` for the other's
      // keys, which does not satisfy `Record<string, string>`.
      const values: Record<string, string> =
        type === "contact"
          ? {
              name: row.displayName,
              first_name: row.givenName ?? "",
              last_name: row.familyName ?? "",
            }
          : {
              name: row.displayName,
              legal_name: row.legalName ?? "",
            };
      return values;
    },
  };
}

const contactEntity = partyEntityType("contact", "person", {
  label: "Contact",
  pluralLabel: "Contacts",
  icon: "user",
});

const companyEntity = partyEntityType("company", "organization", {
  label: "Company",
  pluralLabel: "Companies",
  icon: "building-2",
});

/**
 * A deal.
 *
 * Reads `crm_deals`, so the record-visibility inheritance applies for free: a
 * restricted account's deals are absent from the picker for staff because RLS
 * removed them from the caller's transaction, not because anything here asked.
 */
const dealEntity: MailEntityType = {
  type: "deal",
  label: "Deal",
  pluralLabel: "Deals",
  icon: "handshake",

  async search(tx, ctx, query, limit) {
    const like = contains(query);
    const rows = await tx
      .select({
        id: schema.crmDeals.id,
        title: schema.crmDeals.title,
        amountCents: schema.crmDeals.amountCents,
        partyName: schema.parties.displayName,
        stageName: schema.crmPipelineStages.name,
        updatedAt: schema.crmDeals.updatedAt,
      })
      .from(schema.crmDeals)
      .innerJoin(
        schema.parties,
        and(
          eq(schema.parties.tenantId, schema.crmDeals.tenantId),
          eq(schema.parties.id, schema.crmDeals.partyId),
        ),
      )
      .innerJoin(
        schema.crmPipelineStages,
        and(
          eq(schema.crmPipelineStages.tenantId, schema.crmDeals.tenantId),
          eq(schema.crmPipelineStages.id, schema.crmDeals.stageId),
        ),
      )
      .where(
        and(
          eq(schema.crmDeals.tenantId, ctx.tenantId),
          // Title or the party's name: the two things anybody remembers about
          // a deal while looking at an email about it.
          or(
            ilike(schema.crmDeals.title, like),
            ilike(schema.parties.displayName, like),
          ),
        ),
      )
      .orderBy(desc(schema.crmDeals.updatedAt))
      .limit(limit);

    return rows.map(dealToEntity);
  },

  async resolve(tx, ctx, ids) {
    if (ids.length === 0) return [];
    const rows = await tx
      .select({
        id: schema.crmDeals.id,
        title: schema.crmDeals.title,
        amountCents: schema.crmDeals.amountCents,
        partyName: schema.parties.displayName,
        stageName: schema.crmPipelineStages.name,
        updatedAt: schema.crmDeals.updatedAt,
      })
      .from(schema.crmDeals)
      .innerJoin(
        schema.parties,
        and(
          eq(schema.parties.tenantId, schema.crmDeals.tenantId),
          eq(schema.parties.id, schema.crmDeals.partyId),
        ),
      )
      .innerJoin(
        schema.crmPipelineStages,
        and(
          eq(schema.crmPipelineStages.tenantId, schema.crmDeals.tenantId),
          eq(schema.crmPipelineStages.id, schema.crmDeals.stageId),
        ),
      )
      .where(
        and(
          eq(schema.crmDeals.tenantId, ctx.tenantId),
          inArray(schema.crmDeals.id, [...ids]),
        ),
      );

    return rows.map(dealToEntity);
  },

  templateFields: [
    { key: "title", label: "Deal name" },
    { key: "amount", label: "Deal amount" },
    { key: "stage", label: "Deal stage" },
    { key: "party_name", label: "Who the deal is with" },
  ],

  async templateValues(tx, ctx, entityId) {
    const [row] = await tx
      .select({
        title: schema.crmDeals.title,
        amountCents: schema.crmDeals.amountCents,
        partyName: schema.parties.displayName,
        stageName: schema.crmPipelineStages.name,
      })
      .from(schema.crmDeals)
      .innerJoin(
        schema.parties,
        and(
          eq(schema.parties.tenantId, schema.crmDeals.tenantId),
          eq(schema.parties.id, schema.crmDeals.partyId),
        ),
      )
      .innerJoin(
        schema.crmPipelineStages,
        and(
          eq(schema.crmPipelineStages.tenantId, schema.crmDeals.tenantId),
          eq(schema.crmPipelineStages.id, schema.crmDeals.stageId),
        ),
      )
      .where(
        and(
          eq(schema.crmDeals.tenantId, ctx.tenantId),
          eq(schema.crmDeals.id, entityId),
        ),
      );
    if (!row) return null;

    return {
      title: row.title,
      // Formatted HERE, because Mail renders money it does not understand — and
      // by the same helper the picker's sublabel uses, so an amount quoted in a
      // message and one shown in the picker cannot disagree. An unpriced deal
      // is an empty string rather than "0.00", which would be a number nobody
      // agreed to.
      amount: row.amountCents === null ? "" : `$${formatCents(row.amountCents)}`,
      stage: row.stageName,
      party_name: row.partyName,
    };
  },
};

function dealToEntity(r: {
  id: string;
  title: string;
  amountCents: number | null;
  partyName: string;
  stageName: string;
}): LinkableEntity {
  return {
    entityType: "deal",
    entityId: r.id,
    label: r.title,
    sublabel: [
      r.partyName,
      r.amountCents === null ? null : `$${formatCents(r.amountCents)}`,
      r.stageName,
    ]
      .filter(Boolean)
      .join(" · "),
    href: `/dashboard/m/crm/deals/${r.id}`,
  };
}

/* -- People the composer can address -------------------------------------- */

/**
 * Parties with an email address, as recipient suggestions.
 *
 * Uses the CALLER'S transaction, so this is exactly the set of parties that
 * person may see — nothing here filters on visibility, and nothing needs to.
 *
 * An empty query returns NOTHING rather than everyone: this fires while
 * somebody types an address, and listing every party the moment a recipient
 * field is focused would be a query per composer for suggestions nobody asked
 * for. Same rule the accounting source follows.
 */
async function searchContacts(
  tx: Tx,
  ctx: MailExtensionCtx,
  query: string,
  limit: number,
): Promise<MailContactCandidate[]> {
  const matches = await searchReachableParties(
    tx,
    ctx.tenantId,
    "email",
    query,
    limit,
  );

  return matches.map(({ party, contactPoint }) => ({
    email: contactPoint.value,
    name: party.displayName,
    // Says WHERE this came from. Two rows reading the same name with no other
    // difference is a choice nobody can make — and there WILL be two while the
    // accounting columns still exist.
    sublabel: [
      party.kind === "person" ? "Contact" : "Company",
      contactPoint.label || null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}

export const crmMailExtension: MailExtension = {
  slug: "crm",
  moduleSlug: "crm",
  name: "CRM",
  entityTypes: [contactEntity, companyEntity, dealEntity],
  contacts: { search: searchContacts },
};
