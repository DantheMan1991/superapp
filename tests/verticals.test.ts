import { describe, expect, it } from "vitest";
import sitemap from "../src/app/sitemap";
import { industryRegistry } from "../src/industries";
import { SITE } from "../src/lib/site";
import { faqJsonLd } from "../src/lib/sites/proof";
import { getVertical, listVerticals } from "../src/lib/verticals";
import type { Vertical, VerticalLink } from "../src/lib/verticals";

/**
 * The vertical registry's invariants (`src/lib/verticals/`).
 *
 * These are structural, not editorial — nothing here can check that a claim on
 * a page is TRUE, which is why `homestead.ts` carries the rule about that in a
 * comment at the top and names the three things deliberately left off. What
 * these do catch is the class of mistake a data file makes silently: a hero
 * button pointing at an anchor that isn't on the page, a vertical claiming an
 * industry profile that doesn't exist, an answered question that renders no
 * structured data.
 */

/** Every link a vertical declares, wherever it sits. */
function linksOf(vertical: Vertical): VerticalLink[] {
  const out: VerticalLink[] = [];
  for (const section of vertical.sections) {
    if (section.kind === "hero" || section.kind === "cta") {
      out.push(section.primary);
      if (section.secondary) out.push(section.secondary);
    }
  }
  return out;
}

describe("the vertical registry", () => {
  it("has at least one vertical, and finds each by slug", () => {
    const all = listVerticals();
    expect(all.length).toBeGreaterThan(0);
    for (const vertical of all) {
      expect(getVertical(vertical.slug)).toBe(vertical);
    }
  });

  it("answers null for a slug nobody registered", () => {
    expect(getVertical("not-an-industry")).toBeNull();
    expect(getVertical("")).toBeNull();
  });

  it("has unique slugs that can be a URL segment", () => {
    const slugs = listVerticals().map((v) => v.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
    }
  });

  it("names only industry profiles that exist", () => {
    for (const vertical of listVerticals()) {
      if (vertical.industry === null) continue;
      // A page that promises an industry's tools must resolve to the profile
      // whose packs a signup actually installs, or the two drift.
      expect(
        Object.keys(industryRegistry),
        `${vertical.slug} names industry "${vertical.industry}"`,
      ).toContain(vertical.industry);
    }
  });
});

describe("a vertical's sections", () => {
  it("open with exactly one hero, and it is first", () => {
    for (const vertical of listVerticals()) {
      const heroes = vertical.sections.filter((s) => s.kind === "hero");
      expect(heroes, vertical.slug).toHaveLength(1);
      expect(vertical.sections[0]?.kind, vertical.slug).toBe("hero");
    }
  });

  it("point every anchor link at a section that is on the page", () => {
    for (const vertical of listVerticals()) {
      const ids = new Set(
        vertical.sections
          .map((s) => (s.kind === "capabilities" ? s.id : undefined))
          .filter((id): id is string => Boolean(id)),
      );
      for (const link of linksOf(vertical)) {
        if (!link.href.startsWith("#")) continue;
        expect(ids, `${vertical.slug} → ${link.href}`).toContain(
          link.href.slice(1),
        );
      }
    }
  });

  it("use only in-site paths and anchors — never a bare or external URL", () => {
    for (const vertical of listVerticals()) {
      for (const link of linksOf(vertical)) {
        expect(link.label.trim(), vertical.slug).not.toBe("");
        expect(link.href, `${vertical.slug} → ${link.href}`).toMatch(/^[/#]/);
      }
    }
  });

  it("answer every question they ask, so the FAQ reaches search engines", () => {
    for (const vertical of listVerticals()) {
      const faq = vertical.sections.find((s) => s.kind === "faq");
      if (!faq) continue;
      const ld = faqJsonLd([...faq.items]);
      expect(ld, vertical.slug).not.toBeNull();
      // `faqJsonLd` drops a question with no answer, so an equal count is the
      // assertion that none was dropped.
      expect(
        (ld?.mainEntity as unknown[]).length,
        `${vertical.slug} has an unanswered question`,
      ).toBe(faq.items.length);
    }
  });

  it("carry the words the list page and the tab need", () => {
    for (const vertical of listVerticals()) {
      expect(vertical.name.trim(), vertical.slug).not.toBe("");
      expect(vertical.summary.trim(), vertical.slug).not.toBe("");
      expect(vertical.card.heading.trim(), vertical.slug).not.toBe("");
      expect(vertical.card.body.trim(), vertical.slug).not.toBe("");
      // A search result truncates a title past roughly 60 characters and a
      // description past roughly 160, and a sentence cut mid-word is
      // carelessness on the page that sells a trade. The title is `absolute`
      // in `generateMetadata`, so nothing is appended to these numbers.
      expect(vertical.seo.title.length, vertical.slug).toBeLessThanOrEqual(65);
      expect(vertical.seo.description.length, vertical.slug).toBeLessThanOrEqual(
        160,
      );
    }
  });
});

describe("the sitemap", () => {
  it("invites a crawler to every vertical page and to the list", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain(`${SITE.url}/for`);
    for (const vertical of listVerticals()) {
      expect(urls).toContain(`${SITE.url}/for/${vertical.slug}`);
    }
  });
});
