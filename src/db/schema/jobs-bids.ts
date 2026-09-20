/**
 * Asking subcontractors what a scope will cost, and what they say back
 * (X3, ADR 0098).
 *
 * Part of the `jobs` pack (Layer 2a, P4). The thing the estimate interview
 * kept pointing at: answer *"bidding it out"* on a phase and something has to
 * actually go out. Nothing in the pack did — a `job_commitment` is the
 * subcontract AFTER you have bought the work, and there was no row for the
 * asking.
 *
 * ── IT IS A LINK, NOT AN EMAIL ──────────────────────────────────────────────
 *
 * The obvious build is "email the sub a bid request", and the platform cannot
 * honestly do that yet: SES production access is still denied
 * (`docs/modules/mail-infrastructure.md`), so outbound reaches only verified
 * addresses. Rather than ship a feature that silently fails for real
 * subcontractors, an invitation is a **tokenised link** — the shape the
 * proposal's client link already proved (E5c, ADR 0085) — and the builder
 * sends it however they already talk to that sub. Email delivery becomes one
 * more way to hand over the same link, whenever the relay is free.
 *
 * ── THE CREDENTIALS FOLLOW `job_estimate_shares` EXACTLY ────────────────────
 *
 * Because that table is the platform's answer to this question and a second
 * answer would be a second thing to get wrong. The token is never stored:
 * `token_hash` is a keyed HMAC for lookup and `token_ciphertext` is the token
 * under AES-GCM so the builder can copy the link again. `token_hash` is
 * GLOBALLY unique with no tenant prefix, because the public lookup has no
 * tenant to scope by.
 *
 * ── A REPLY IS A RECORD, AND AWARDING IS A SEPARATE ACT ─────────────────────
 *
 * A subcontractor types a number or says no bid; that is a fact about what
 * they said, the same shape as a lien waiver (ADR 0066) or an acceptance
 * (ADR 0085). It buys nothing and commits nobody. The BUSINESS awards one,
 * later, on their own screen — and even that only decides which number the
 * estimate uses. Buying the work is still a commitment.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { parties } from "./parties";
import { jobProjects } from "./jobs";

export const BID_PACKAGE_STATUSES = ["open", "closed"] as const;
export type BidPackageStatus = (typeof BID_PACKAGE_STATUSES)[number];

/**
 * ONE SCOPE BEING PRICED: "Electrical", "Concrete flatwork", "Demolition".
 *
 * Hung on the JOB rather than an estimate, because a business asks for a
 * number once and may price two revisions of the bid with it. The cost code
 * is TEXT, the same call as the outline's and the assembly's (ADR 0086): a
 * code's id belongs to one list, and a package outlives the estimate that
 * prompted it.
 */
export const jobBidPackages = pgTable(
  "job_bid_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** What is being priced, as the trade says it. */
    title: text("title").notNull(),
    /** By its digits. Blank when the work does not belong to one code. */
    costCode: text("cost_code").notNull().default(""),
    /** The scope, in the builder's words. **This is what a subcontractor reads.** */
    scope: text("scope").notNull().default(""),
    /** When numbers are wanted by. Null means no date was given. */
    dueOn: date("due_on", { mode: "string" }),
    /** text + CHECK: open, closed. Awarded is derived from the invitations. */
    status: text("status").notNull().default("open"),
    /** The builder's own notes. Never shown to a subcontractor. */
    notes: text("notes").notNull().default(""),
    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_bid_packages_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_bid_packages_tenant_project_idx").on(t.tenantId, t.projectId),
    /** A package is part of the job it prices. */
    foreignKey({
      name: "job_bid_packages_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    check("job_bid_packages_title_present", sql`length(btrim(${t.title})) > 0`),
    check(
      "job_bid_packages_status_valid",
      sql`${t.status} in ('open', 'closed')`,
    ),
  ],
);

/**
 * ONE SUBCONTRACTOR ASKED, AND WHAT THEY SAID.
 *
 * The invitation IS the door: each sub gets their own token, so a forwarded
 * link is one sub's link and revoking it takes back one sub's access. One
 * link for the whole package would make "who has seen this" unanswerable and
 * "stop that one" impossible.
 */
export const jobBidInvitations = pgTable(
  "job_bid_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    packageId: uuid("package_id").notNull(),
    /** Who was asked. A subcontractor the business already keeps. */
    partyId: uuid("party_id").notNull(),

    /* ---- the door, exactly as `job_estimate_shares` mints one ---- */
    tokenHash: text("token_hash").notNull(),
    tokenCiphertext: text("token_ciphertext").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByClerkUserId: text("revoked_by_clerk_user_id"),
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),

    /* ---- what they said: all of it together, or none of it ---- */
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    /** Their number. Null on a no-bid. */
    amountCents: bigint("amount_cents", { mode: "number" }),
    /** They looked and said no. A useful fact, and not the same as silence. */
    declined: boolean("declined").notNull().default(false),
    /** What they typed. Never trusted as identity — it is what they wrote. */
    repliedName: text("replied_name").notNull().default(""),
    /** Anything they wanted to add: exclusions, a lead time, a condition. */
    replyNote: text("reply_note").notNull().default(""),
    /** Hashed, like every other IP on an anonymous surface. Never raw. */
    repliedIpHash: text("replied_ip_hash"),

    /** The one the business is going with. At most one per package. */
    isAwarded: boolean("is_awarded").notNull().default(false),

    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_bid_invitations_tenant_id_id_idx").on(t.tenantId, t.id),
    /** GLOBALLY unique, with no tenant prefix: the lookup has no tenant yet. */
    uniqueIndex("job_bid_invitations_token_hash_idx").on(t.tokenHash),
    index("job_bid_invitations_tenant_package_idx").on(t.tenantId, t.packageId),
    /** One invitation per subcontractor per package; asking twice is one ask. */
    uniqueIndex("job_bid_invitations_one_per_party_idx").on(
      t.tenantId,
      t.packageId,
      t.partyId,
    ),
    /** AT MOST ONE AWARD, by the database rather than by a code path. */
    uniqueIndex("job_bid_invitations_one_award_idx")
      .on(t.tenantId, t.packageId)
      .where(sql`${t.isAwarded}`),
    foreignKey({
      name: "job_bid_invitations_package_fk",
      columns: [t.tenantId, t.packageId],
      foreignColumns: [jobBidPackages.tenantId, jobBidPackages.id],
    }).onDelete("cascade"),
    /** RESTRICT: a subcontractor who has been asked for a number is kept. */
    foreignKey({
      name: "job_bid_invitations_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    check("job_bid_invitations_amount_sane", sql`${t.amountCents} is null or ${t.amountCents} >= 0`),
    /**
     * **A REPLY IS A WHOLE FACT OR NONE OF ONE**, the shape a signature on a
     * proposal has (ADR 0085). Half of one is not evidence: a number with no
     * date is a number nobody can place, and a date with neither a number nor
     * a decline says only that something happened.
     */
    check(
      "job_bid_invitations_reply_whole",
      sql`(${t.repliedAt} is null
            and ${t.amountCents} is null
            and not ${t.declined}
            and ${t.repliedName} = '')
          or (${t.repliedAt} is not null
            and length(btrim(${t.repliedName})) > 0
            and ((${t.declined} and ${t.amountCents} is null)
              or (not ${t.declined} and ${t.amountCents} is not null)))`,
    ),
    /**
     * **YOU CANNOT AWARD A NUMBER NOBODY GAVE.** Awarding a silence or a
     * no-bid would put a price on an estimate with nothing behind it, which
     * is the one thing this whole program refuses.
     */
    check(
      "job_bid_invitations_award_has_a_number",
      sql`not ${t.isAwarded} or ${t.amountCents} is not null`,
    ),
  ],
);

export type JobBidPackage = typeof jobBidPackages.$inferSelect;
export type JobBidInvitation = typeof jobBidInvitations.$inferSelect;
