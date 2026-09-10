/**
 * Seed a vertical's marketing page (`src/lib/verticals/`) into the operator
 * tenant's own website, so the founder can edit it in the Marketing module
 * instead of in a TypeScript file.
 *
 *   npx tsx scripts/seed-vertical-site.ts homestead [--dev]
 *
 * "Yosher runs on Yosher" (ADR 0041): the operator tenant is an ordinary
 * tenant, and this writes through the module's own ops under `withTenant`, so
 * RLS is exercised exactly as it would be for a client.
 *
 * CREATE-ONLY, DELIBERATELY. It refuses when the tenant already has a site.
 * The vertical data file is the SOURCE for the first write and nothing after
 * it — once a person has edited the site, re-running this would overwrite
 * their work with a stale copy, and there is no merge that could be right.
 *
 * The page is written as a DRAFT and the site's status stays `draft`, so
 * nothing is publicly reachable until somebody presses Publish.
 *
 * WHAT DOES NOT SURVIVE THE MOVE, and it is worth knowing before running:
 *
 *   - **The icons.** `CARD_ICON_NAMES` is a curated, industry-NEUTRAL set (a
 *     core module speaks no industry), so there is no cow, fence, shears or
 *     tractor. `SITE_ICONS` below is the least-wrong mapping and it is a
 *     visible downgrade from the code page.
 *   - **The numbered walk-through.** The site has no numbered-narrative
 *     section, so the spotlight becomes a Columns section and the sequence is
 *     carried in the card headings ("1. …") rather than by the layout.
 *   - **The CTA's paragraph.** A `cta` section is a headline and one button.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { schema, withSystem, withTenant } from "@/db";
import { PageContentSchema, type Section } from "@/lib/sites/schema";
import { EMPTY_SETTINGS } from "@/lib/sites/schema";
import { getVertical } from "@/lib/verticals";
import type { Vertical } from "@/lib/verticals";
import { CONTACT, SITE } from "@/lib/site";

/**
 * The rows are written here rather than through `@/modules/marketing/site-ops`,
 * for the reason `scripts/operator-tenant.ts:21` already records: that module
 * is `server-only` and a script cannot import it. `tsx --conditions
 * react-server` satisfies `server-only` but then breaks `lucide-react`, which
 * this script reaches through the vertical's icons — data holding React
 * components cannot cross a process boundary. Two inserts inside `withTenant`
 * are the smaller price, and RLS still has to allow them.
 */

/** Yosher's own colours: the navy `manifest.ts` already declares, and `--brand`. */
const YOSHER_PRIMARY = "#13203e";
const YOSHER_ACCENT = "#2ead8a";

/**
 * A capability's heading → the nearest icon in the site's neutral set.
 * Keyed by heading rather than derived, because the two sets do not
 * correspond and pretending otherwise would pick badly and silently.
 */
const SITE_ICONS: Record<string, string> = {
  "The herd": "users",
  "The ground": "map-pin",
  "The butcher": "calendar",
  "What's in the freezer": "package",
  "The shop": "shopping-bag",
  "The books": "credit-card",
  "The farm's website": "sparkles",
  "Everything else": "check",
  "Start with the health check": "check",
  "Switch on what you need": "leaf",
  "We fit the last part to you": "wrench",
};

/** Card ids are made once and kept, so a dragged card holds its place. */
const cardId = () => randomBytes(4).toString("hex");

/** An in-site link on a vertical page becomes an absolute one on its own site. */
function absolute(href: string): string {
  if (href.startsWith("#")) return SITE.url;
  if (href.startsWith("/")) return `${SITE.url}${href}`;
  return href;
}

function sectionsFor(vertical: Vertical): Section[] {
  const out: Section[] = [];
  for (const section of vertical.sections) {
    switch (section.kind) {
      case "hero":
        out.push({
          type: "hero",
          eyebrow: section.eyebrow,
          headline: section.heading,
          subheadline: section.body,
          cta: { label: section.primary.label, href: absolute(section.primary.href) },
          // The code page's second button is an in-page jump, which a site
          // link cannot be; on a one-page site it had nowhere to go anyway.
          secondary: null,
          image: null,
          height: "standard",
        });
        break;
      case "problems":
        out.push({
          type: "columns",
          heading: section.heading,
          intro: section.body ?? "",
          columns: 2,
          widths: "equal",
          look: "cards",
          cards: section.items.map((item) => ({
            id: cardId(),
            image: null,
            icon: "",
            heading: item.title,
            body: [item.body],
            cta: null,
          })),
        });
        break;
      case "capabilities":
        out.push({
          type: "columns",
          heading: section.heading,
          intro: section.body ?? "",
          columns: 4,
          widths: "equal",
          look: "plain",
          cards: section.items.map((item) => ({
            id: cardId(),
            image: null,
            icon: SITE_ICONS[item.title] ?? "",
            heading: item.title,
            body: [item.body],
            cta: null,
          })),
        });
        break;
      case "spotlight":
        out.push({
          type: "columns",
          heading: section.heading,
          intro: section.body,
          columns: 3,
          widths: "equal",
          look: "cards",
          // The number moves into the heading: the layout can no longer carry it.
          cards: section.points.map((point, i) => ({
            id: cardId(),
            image: null,
            icon: "",
            heading: `${i + 1}. ${point.title}`,
            body: [point.body],
            cta: null,
          })),
        });
        if (section.footnote) {
          out.push({ type: "text", heading: "", body: [section.footnote] });
        }
        break;
      case "steps":
        out.push({
          type: "columns",
          heading: section.heading,
          intro: section.body ?? "",
          columns: 3,
          widths: "equal",
          look: "plain",
          cards: section.items.map((item, i) => ({
            id: cardId(),
            image: null,
            icon: SITE_ICONS[item.title] ?? "",
            heading: `${i + 1}. ${item.title}`,
            body: [item.body],
            cta: null,
          })),
        });
        break;
      case "faq":
        out.push({
          type: "faq",
          heading: section.heading,
          note: "",
          items: section.items.map((item) => ({ question: item.question, answer: item.answer })),
        });
        break;
      case "cta":
        // The upgrade the tool brings: an enquiry here becomes a party, a CRM
        // record and a follow-up (ADR 0021), where the code page could only
        // link away to the health check.
        out.push({
          type: "form",
          heading: "Tell us about your place",
          note: section.body,
          buttonLabel: "Send",
          askPhone: true,
          thanks: "",
          fields: [],
        });
        out.push({
          type: "cta",
          headline: section.heading,
          cta: { label: section.primary.label, href: absolute(section.primary.href) },
        });
        break;
    }
  }
  return out;
}

async function main() {
  const slug = process.argv[2];
  const vertical = slug ? getVertical(slug) : null;
  if (!vertical) {
    console.error(`Usage: npx tsx scripts/seed-vertical-site.ts <vertical>`);
    console.error(`Unknown vertical: ${slug ?? "(none)"}`);
    process.exit(1);
  }

  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").split("/")[0];
  console.log(`Database: ${host}`);
  console.log(`Vertical: ${vertical.name} (${vertical.slug})`);

  const operator = await withSystem(async (tx) =>
    tx.query.tenants.findFirst({
      where: eq(schema.tenants.isOperator, true),
      columns: { id: true, name: true, slug: true },
    }),
  );
  if (!operator) {
    console.error("No operator tenant (tenants.is_operator). Nothing to seed into.");
    process.exit(1);
  }
  console.log(`Operator tenant: ${operator.name} (${operator.id})`);

  const sections = sectionsFor(vertical);
  const content = PageContentSchema.parse({
    description: vertical.seo.description,
    seoTitle: vertical.seo.title,
    sections,
  });
  console.log(`Assembled ${sections.length} sections; content validates.`);

  // `role: 'owner'` because this writes what only an owner may write, and the
  // value must be a real role rather than a convenient one.
  const ctx = { tenantId: operator.id, userId: "seed-script", role: "owner" as const };

  await withTenant(
    operator.id,
    async (tx) => {
      const existing = await tx.query.sites.findFirst({
        where: eq(schema.sites.tenantId, operator.id),
        columns: { id: true, slug: true, status: true },
      });
      if (existing) {
        console.error(
          `\nREFUSED: this tenant already has a site (${existing.slug}, ${existing.status}).`,
        );
        console.error(
          "One site per tenant (sites_tenant_idx), and this script never overwrites one.",
        );
        process.exit(1);
      }

      // The kit is the TENANT's, not the vertical's: `displayName` is what the
      // invoice PDF prints (ADR 0018), so it stays "Yosher". The site carries
      // the sub-brand in `sites.title` instead, which the header prefers.
      const kit = await tx.query.brandKits.findFirst({
        where: eq(schema.brandKits.tenantId, operator.id),
        columns: { id: true, displayName: true },
      });
      if (kit) {
        console.log(`Brand kit already there (${kit.displayName || "unnamed"}); left alone.`);
      } else {
        await tx.insert(schema.brandKits).values({
          tenantId: operator.id,
          displayName: SITE.name,
          tagline: SITE.tagline,
          primaryColor: YOSHER_PRIMARY,
          accentColor: YOSHER_ACCENT,
        });
        console.log(`Brand kit created: ${SITE.name} / ${YOSHER_PRIMARY} + ${YOSHER_ACCENT}`);
      }

      const [site] = await tx
        .insert(schema.sites)
        .values({
          tenantId: ctx.tenantId,
          slug: `yosher-${vertical.slug}`,
          // The sub-brand lives HERE, not on the kit: the site header prefers
          // `sites.title`, so the page reads "Yosher Homestead" while invoices
          // keep printing "Yosher".
          title: vertical.name,
          settings: {
            ...EMPTY_SETTINGS,
            email: CONTACT.email,
            about: vertical.summary,
            footerNote: "Part of Yosher. The outsourced business office.",
          },
          copySource: "standard",
        })
        .returning();
      if (!site) throw new Error("site not created");
      console.log(`Site created: /sites/${site.slug} (${site.status}), title "${site.title}"`);

      await tx.insert(schema.sitePages).values({
        tenantId: ctx.tenantId,
        siteId: site.id,
        path: "/",
        title: "Home",
        navOrder: 0,
        inNav: true,
        draft: content,
      });
      console.log(`Draft written: / (${content.sections.length} sections)`);
      console.log(`\nUNPUBLISHED. Edit at /dashboard/m/marketing, publish when ready.`);
    },
    { role: "owner" },
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
