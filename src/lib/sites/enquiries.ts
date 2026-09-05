import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "@/db";
import type { SiteEnquiry } from "@/db/schema";
import { logAuditInTx } from "@/lib/audit";
import { sendEmail } from "@/lib/email/send";
import { isModuleEnabled } from "@/lib/modules";
import { createParty, PartyError } from "@/lib/parties";
import { addContactPoint, findPartiesByContact } from "@/lib/parties/contacts";
import { ipKey, overPublicCap, startOfUtcDay } from "@/lib/public-caps";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import { todayInTimezone } from "@/lib/timezone";
import { createUnlinkedWork, createWorkForEntity } from "@/lib/work/entity-work";
import {
  answersFromForm,
  ENQUIRY_DAILY_CAP,
  ENQUIRY_HOURLY_IP_CAP,
  ENQUIRY_SITE_DAILY_CAP,
  enquiryEmail,
  enquiryNotes,
  enquiryWorkTitle,
  splitPersonName,
  type EnquiryWords,
  type SiteEnquiryInput,
} from "./enquiry-schema";
import { lookupSiteBySlug } from "./read";
import { readPageContent, readSiteSettings } from "./schema";
import { normalizeSiteSlug } from "./slug";

/**
 * A message from a site's form, landing in the workspace — ADR 0021.
 *
 * THE ONE PUBLIC WRITE PATH INTO A TENANT (the view beacon, ADR 0022, is
 * the smaller second). A stranger's request carries no session, so the
 * site's slug is turned into a tenant by the same trusted lookup the
 * renderer uses (`lookupSiteBySlug`, `withSystem`, identifiers only), and
 * only a PUBLISHED site takes messages. Everything after that runs as
 * `staff` inside the tenant's own context, through the shared doors every
 * member action uses — `createParty`, `addContactPoint`,
 * `createWorkForEntity` — so the database is still deciding what a form may
 * write, and it is exactly what a staff member could.
 *
 * What one message becomes, in one transaction:
 *   1. a PARTY: matched by email if the business already knows the address,
 *      otherwise a new person, with the email (and phone) as contact points;
 *   2. a CRM record with `source = 'website'` — only when CRM is switched on,
 *      because the table is CRM's and a feature that is off writes nothing;
 *   3. a FOLLOW-UP in Work, due today, linked to the contact when CRM is on
 *      (the guard is the owning feature) and unlinked otherwise;
 *   4. the `site_enquiries` row, the record of what was actually sent, the
 *      business's own questions answered included;
 *   5. an audit row, identifiers only.
 * Then, outside the transaction, the business is EMAILED — to the site's
 * contact email if the details name one, else to every owner — with Reply-To
 * set to the sender. A failed send is logged and never fails the message;
 * the row and the follow-up already exist.
 *
 * THE QUESTIONS ARE READ FROM THE PUBLISHED PAGE, never from the request:
 * the form names its page and its place on it, and the answers are checked
 * against what that section says the questions are. A form on a page that
 * has since changed simply has its answers dropped.
 *
 * Caps: per IP per hour and platform-wide per day in `public_access_attempts`
 * (`src/lib/public-caps.ts`), plus a per-site daily count on this table so
 * one bot cannot fill one inbox and one work list.
 */

export const ENQUIRY_ATTEMPT_KIND = "site_enquiry";

const CAP = {
  kind: ENQUIRY_ATTEMPT_KIND,
  hourlyIpCap: ENQUIRY_HOURLY_IP_CAP,
  dailyCap: ENQUIRY_DAILY_CAP,
};

export type ReceiveResult =
  | { ok: true }
  | { ok: false; reason: "fields"; fieldErrors: Record<string, string> }
  | { ok: false; reason: "capped" | "unavailable" | "failed" };

type NotifyPlan =
  | { via: "site_email"; recipients: { key: string; email: string }[] }
  | { via: "owners"; recipients: { key: string; email: string }[] }
  | { via: "none"; recipients: [] };

interface Landed {
  enquiryId: string;
  tenantId: string;
  words: EnquiryWords;
  contactRecord: boolean;
  plan: NotifyPlan;
}

type Outcome =
  | { kind: "landed"; landed: Landed }
  | { kind: "capped" }
  | { kind: "unavailable" }
  | { kind: "fields"; errors: Record<string, string> };

/**
 * Who gets the business's copy. The site's contact email is what the
 * business tells customers to write to, so it wins; without one, every
 * owner's profile address — never anything the visitor typed. Read under
 * `withSystem` because `profiles` belong to the platform, not the tenant,
 * and the query takes only the tenant id the trusted lookup produced.
 */
export async function notifyPlan(tenantId: string, settingsEmail: string): Promise<NotifyPlan> {
  if (settingsEmail) return { via: "site_email", recipients: [{ key: "site", email: settingsEmail }] };
  const owners = await withSystem((tx) =>
    tx
      .select({ profileId: schema.memberships.profileId, email: schema.profiles.email })
      .from(schema.memberships)
      .innerJoin(schema.profiles, eq(schema.profiles.id, schema.memberships.profileId))
      .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, "owner"))),
  );
  const recipients = owners
    .filter((o) => !!o.email)
    .map((o) => ({ key: o.profileId, email: o.email as string }));
  return recipients.length > 0 ? { via: "owners", recipients } : { via: "none", recipients: [] };
}

/** A contact point that is not usable is left out; the message still carries it. */
export async function tryAddContactPoint(
  tx: Tx,
  tenantId: string,
  partyId: string,
  kind: "email" | "phone",
  value: string,
): Promise<void> {
  try {
    await addContactPoint(tx, tenantId, partyId, { kind, value });
  } catch (err) {
    if (err instanceof PartyError && err.code === "CONTACT_VALUE_INVALID") return;
    throw err;
  }
}

export async function receiveSiteEnquiry(
  input: SiteEnquiryInput,
  rawAnswers: Record<string, string>,
  ip: string,
): Promise<ReceiveResult> {
  const slug = normalizeSiteSlug(input.site);
  if (!slug.ok) return { ok: false, reason: "unavailable" };
  const hit = await lookupSiteBySlug(slug.slug);
  if (!hit || hit.status !== "published") return { ok: false, reason: "unavailable" };

  const ipHash = ipKey(ip);
  if (await overPublicCap(CAP, ipHash)) return { ok: false, reason: "capped" };

  const crmOn = await isModuleEnabled(hit.tenantId, "crm");

  let outcome: Outcome;
  try {
    outcome = await withTenant(
      hit.tenantId,
      async (tx): Promise<Outcome> => {
        const site = await tx.query.sites.findFirst({
          where: and(eq(schema.sites.tenantId, hit.tenantId), eq(schema.sites.id, hit.id)),
        });
        if (!site || site.status !== "published") return { kind: "unavailable" };

        const [{ n: today }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.siteEnquiries)
          .where(
            and(
              eq(schema.siteEnquiries.tenantId, hit.tenantId),
              eq(schema.siteEnquiries.siteId, site.id),
              gte(schema.siteEnquiries.createdAt, startOfUtcDay(new Date())),
            ),
          );
        if (today >= ENQUIRY_SITE_DAILY_CAP) return { kind: "capped" };

        // The business's questions, from the PUBLISHED page the form was on.
        const pagePath = input.page || "/";
        const page = await tx.query.sitePages.findFirst({
          where: and(
            eq(schema.sitePages.tenantId, hit.tenantId),
            eq(schema.sitePages.siteId, site.id),
            eq(schema.sitePages.path, pagePath),
          ),
          columns: { published: true },
        });
        const section = page ? readPageContent(page.published).sections[input.section] : undefined;
        const fields = section?.type === "form" ? section.fields : [];
        const checked = answersFromForm(fields, (name) => rawAnswers[name] ?? "");
        if (Object.keys(checked.errors).length > 0) return { kind: "fields", errors: checked.errors };

        const settings = readSiteSettings(site.settings);
        const plan = await notifyPlan(hit.tenantId, settings.email);

        const tenant = await tx.query.tenants.findFirst({
          where: eq(schema.tenants.id, hit.tenantId),
          columns: { name: true },
        });
        const timezone = await getTenantTimezone(tx, hit.tenantId);
        const receivedOn = todayInTimezone(timezone);

        // 1. The party: known by this email, or new.
        const matches = await findPartiesByContact(tx, hit.tenantId, "email", input.email);
        const party =
          matches[0]?.party ??
          (await createParty(tx, hit.tenantId, {
            kind: "person",
            displayName: input.name,
            ...splitPersonName(input.name),
          }));
        await tryAddContactPoint(tx, hit.tenantId, party.id, "email", input.email);
        if (input.phone) await tryAddContactPoint(tx, hit.tenantId, party.id, "phone", input.phone);

        // 2. CRM's record, only when CRM is on. Existing details keep their
        //    own source; the website is where a NEW record came from.
        if (crmOn) {
          await tx
            .insert(schema.crmPartyDetails)
            .values({ tenantId: hit.tenantId, partyId: party.id, source: "website" })
            .onConflictDoNothing();
        }

        // 3. The follow-up, due today so it reaches the morning digest.
        const words: EnquiryWords = {
          siteTitle: site.title || tenant?.name || "your website",
          pagePath,
          name: input.name,
          email: input.email,
          phone: input.phone,
          message: input.message,
          answers: checked.answers,
          receivedOn,
        };
        const workInput = { title: enquiryWorkTitle(input.name), notes: enquiryNotes(words), dueOn: receivedOn };
        const workCtx = { tenantId: hit.tenantId, userId: "" };
        const workItemId = crmOn
          ? await createWorkForEntity(
              tx,
              workCtx,
              { extensionSlug: "crm", entityType: "contact", entityId: party.id },
              workInput,
            )
          : await createUnlinkedWork(tx, workCtx, workInput);

        // 4. The record of what was sent.
        const [row] = await tx
          .insert(schema.siteEnquiries)
          .values({
            tenantId: hit.tenantId,
            siteId: site.id,
            pagePath,
            name: input.name,
            email: input.email,
            phone: input.phone,
            message: input.message,
            answers: checked.answers,
            partyId: party.id,
            workItemId,
            notifyVia: plan.via,
            ipHash,
          })
          .returning({ id: schema.siteEnquiries.id });

        // 5. Identifiers only: never the name, the email or the message.
        await logAuditInTx(tx, {
          action: "site.enquiry.received",
          tenantId: hit.tenantId,
          targetType: "site_enquiry",
          targetId: row.id,
          meta: {
            siteId: site.id,
            partyId: party.id,
            matchedExisting: matches.length > 0,
            workItemId,
            crmRecord: crmOn,
            notifyVia: plan.via,
            answers: checked.answers.length,
          },
        });

        return {
          kind: "landed",
          landed: { enquiryId: row.id, tenantId: hit.tenantId, words, contactRecord: crmOn, plan },
        };
      },
      { role: "staff" },
    );
  } catch (err) {
    console.error("site enquiry: could not be recorded", err instanceof Error ? err.message : err);
    return { ok: false, reason: "failed" };
  }
  if (outcome.kind === "unavailable") return { ok: false, reason: "unavailable" };
  if (outcome.kind === "capped") return { ok: false, reason: "capped" };
  if (outcome.kind === "fields") return { ok: false, reason: "fields", fieldErrors: outcome.errors };

  // The business's copy. Outside the transaction: the message is already
  // safe, and a provider hiccup must not undo it.
  const { landed } = outcome;
  const mail = enquiryEmail(landed.words, { followUp: true, contact: landed.contactRecord });
  for (const to of landed.plan.recipients) {
    const sent = await sendEmail({
      tenantId: landed.tenantId,
      kind: "enquiry",
      to: to.email,
      subject: mail.subject,
      text: mail.text,
      idempotencyKey: `enquiry:${landed.enquiryId}:${to.key}`,
      replyTo: landed.words.email,
    });
    // Reason only — never the address or the subject (S9).
    if (!sent.ok) console.error(`site enquiry: email not sent (${sent.reason})`);
  }
  return { ok: true };
}

/* -- The Website screen's list --------------------------------------------- */

export interface EnquiryRow {
  enquiry: SiteEnquiry;
  /** The party's current display name; null when it no longer exists. */
  partyName: string | null;
  /** `open`, `done`, or `gone` when the item was deleted. */
  followUp: "open" | "done" | "gone" | "none";
}

export const ENQUIRIES_SHOWN = 30;

/** Newest first, with the soft pointers resolved under the caller's context. */
export async function listSiteEnquiries(
  tx: Tx,
  tenantId: string,
  siteId: string,
  limit = ENQUIRIES_SHOWN,
): Promise<EnquiryRow[]> {
  const rows = await tx.query.siteEnquiries.findMany({
    where: and(eq(schema.siteEnquiries.tenantId, tenantId), eq(schema.siteEnquiries.siteId, siteId)),
    orderBy: desc(schema.siteEnquiries.createdAt),
    limit,
  });
  if (rows.length === 0) return [];

  const partyIds = [...new Set(rows.map((r) => r.partyId).filter((id): id is string => !!id))];
  const parties =
    partyIds.length > 0
      ? await tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(and(eq(schema.parties.tenantId, tenantId), inArray(schema.parties.id, partyIds)))
      : [];
  const partyName = new Map(parties.map((p) => [p.id, p.name]));

  const itemIds = [...new Set(rows.map((r) => r.workItemId).filter((id): id is string => !!id))];
  const items =
    itemIds.length > 0
      ? await tx
          .select({ id: schema.workItems.id, closedAt: schema.workItems.closedAt })
          .from(schema.workItems)
          .where(and(eq(schema.workItems.tenantId, tenantId), inArray(schema.workItems.id, itemIds)))
      : [];
  const itemState = new Map(items.map((i) => [i.id, i.closedAt ? ("done" as const) : ("open" as const)]));

  return rows.map((enquiry) => ({
    enquiry,
    partyName: enquiry.partyId ? (partyName.get(enquiry.partyId) ?? null) : null,
    followUp: enquiry.workItemId ? (itemState.get(enquiry.workItemId) ?? "gone") : "none",
  }));
}
