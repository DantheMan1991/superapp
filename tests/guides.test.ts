import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyLabels,
  buildVocabulary,
  FIXED_SECTIONS,
  guideIndexFor,
  matchGuide,
  matchRoute,
  MODIFIERS,
  openHref,
  parseGuide,
  parseRoutePattern,
  placeholders,
  sortGuides,
  type GuideMeta,
  type RoutePattern,
  controlMarkerProblem,
  controlMarkers,
  guideAreas,
} from "../src/lib/guides-core";
import { resolveDocLink } from "../src/lib/markdown-meta";
import {
  getGuide,
  guideDefinitions,
  guideVocabulary,
  listGuides,
  localiseGuide,
} from "../src/lib/guides";
import { featureRegistry } from "../src/lib/features";
import { controlIconNames } from "../src/components/app/guide-icons";

/**
 * The tenant guides: the route grammar that puts a guide on a screen, the
 * placeholder grammar that puts a tenant's own words in it, and the checks
 * over the real `docs/help/` tree that keep both honest.
 *
 * The tree checks are the important ones. A guide is prose nobody compiles:
 * `{{zonee}}` renders as `{{zonee}}` on a client's screen, and a `**Route:**`
 * with a typo means the "?" on that screen says "no guide yet" while the guide
 * sits right there. Both fail here instead. Nothing asserts exact prose — a
 * test that fails when a sentence is improved teaches people not to improve
 * sentences.
 *
 * Filesystem only, no database, so it belongs on the parallel side.
 */

const pattern = (raw: string): RoutePattern => {
  const parsed = parseRoutePattern(raw);
  if (!parsed) throw new Error(`invalid route pattern in test: ${raw}`);
  return parsed;
};

const hit = (route: string, pathname: string, search = "") =>
  matchRoute(pattern(route), pathname, new URLSearchParams(search));

const guide = (slug: string, ...routes: string[]): GuideMeta => {
  const [feature, ...rest] = slug.split("/");
  return {
    slug,
    feature,
    topic: rest.join("/"),
    title: slug,
    summary: "",
    order: 100,
    routes: routes.map(pattern),
    area: null,
  };
};

describe("route patterns", () => {
  it("matches a literal path exactly and nothing beneath it", () => {
    expect(hit("/dashboard/m/accounting", "/dashboard/m/accounting")).toBe(true);
    expect(hit("/dashboard/m/accounting", "/dashboard/m/accounting/bills")).toBe(false);
    expect(hit("/dashboard/m/accounting", "/dashboard/m")).toBe(false);
  });

  it("`*` matches exactly one segment", () => {
    expect(hit("/dashboard/m/land/*", "/dashboard/m/land/abc")).toBe(true);
    expect(hit("/dashboard/m/land/*", "/dashboard/m/land")).toBe(false);
    expect(hit("/dashboard/m/land/*", "/dashboard/m/land/abc/zones")).toBe(false);
  });

  it("`**` matches the route itself and everything beneath it", () => {
    expect(hit("/dashboard/m/land/**", "/dashboard/m/land")).toBe(true);
    expect(hit("/dashboard/m/land/**", "/dashboard/m/land/abc/zones/def")).toBe(true);
    expect(hit("/dashboard/m/land/**", "/dashboard/m/livestock")).toBe(false);
  });

  it("ignores a trailing slash on either side", () => {
    expect(hit("/dashboard/today/", "/dashboard/today")).toBe(true);
    expect(hit("/dashboard/today", "/dashboard/today/")).toBe(true);
  });

  it("requires every query condition to hold", () => {
    expect(
      hit("/dashboard/m/email?rules=1&away", "/dashboard/m/email", "rules=1&away=1"),
    ).toBe(true);
    expect(hit("/dashboard/m/email?rules=1&away", "/dashboard/m/email", "rules=1")).toBe(
      false,
    );
  });

  it("`?key` matches presence and `?key=value` matches the value", () => {
    expect(hit("/dashboard/m/email?message", "/dashboard/m/email", "message=abc")).toBe(true);
    expect(hit("/dashboard/m/email?compose=new", "/dashboard/m/email", "compose=new")).toBe(
      true,
    );
    expect(
      hit("/dashboard/m/email?compose=new", "/dashboard/m/email", "compose=reply"),
    ).toBe(false);
    expect(hit("/dashboard/m/email?compose=new", "/dashboard/m/email")).toBe(false);
  });

  it("rejects a pattern outside /dashboard or with `**` before the end", () => {
    expect(parseRoutePattern("/admin/docs")).toBeNull();
    expect(parseRoutePattern("/dashboardish")).toBeNull();
    expect(parseRoutePattern("/dashboard/m/**/bills")).toBeNull();
    expect(parseRoutePattern("")).toBeNull();
    // Backticks are how an author would naturally quote a path in markdown.
    expect(parseRoutePattern("`/dashboard/m/land/**`")?.segments).toEqual([
      "dashboard",
      "m",
      "land",
      "**",
    ]);
  });
});

describe("matchGuide", () => {
  it("a literal segment beats a wildcard at the same depth", () => {
    const guides = [
      guide("land/find", "/dashboard/m/land/find"),
      guide("land/parcel", "/dashboard/m/land/*"),
    ];
    expect(matchGuide(guides, "/dashboard/m/land/find", "")?.slug).toBe("land/find");
    expect(matchGuide(guides, "/dashboard/m/land/abc", "")?.slug).toBe("land/parcel");
  });

  it("an exact route beats a subtree route at the same depth", () => {
    // `overview.md` covers the whole module with `**`; the list screen's own
    // guide declares the bare route. Same three literals — the exact one wins,
    // whatever the slugs happen to sort as.
    const guides = [
      guide("land/overview", "/dashboard/m/land/**"),
      guide("land/parcels", "/dashboard/m/land"),
    ];
    expect(matchGuide(guides, "/dashboard/m/land", "")?.slug).toBe("land/parcels");
    expect(matchGuide(guides, "/dashboard/m/land/abc", "")?.slug).toBe("land/overview");
  });

  it("one wildcard beats a subtree", () => {
    const guides = [
      guide("land/overview", "/dashboard/m/land/**"),
      guide("land/parcel", "/dashboard/m/land/*"),
    ];
    expect(matchGuide(guides, "/dashboard/m/land/abc", "")?.slug).toBe("land/parcel");
    expect(matchGuide(guides, "/dashboard/m/land/abc/zones", "")?.slug).toBe(
      "land/overview",
    );
  });

  it("a query condition breaks a tie between equal paths", () => {
    const guides = [
      guide("email/overview", "/dashboard/m/email/**"),
      guide("email/rules", "/dashboard/m/email?rules=1"),
    ];
    expect(matchGuide(guides, "/dashboard/m/email", "?rules=1")?.slug).toBe("email/rules");
    expect(matchGuide(guides, "/dashboard/m/email", "")?.slug).toBe("email/overview");
  });

  it("returns null rather than a parent's guide for an unrelated screen", () => {
    // The whole point of exact-by-default: "Getting around" must not answer
    // for an accounting screen that has no guide yet.
    const guides = [guide("workspace/getting-around", "/dashboard")];
    expect(matchGuide(guides, "/dashboard/m/accounting/bills", "")).toBeNull();
  });

  it("is deterministic when two guides tie", () => {
    const a = guide("land/a", "/dashboard/m/land/**");
    const b = guide("land/b", "/dashboard/m/land/**");
    expect(matchGuide([b, a], "/dashboard/m/land", "")?.slug).toBe("land/a");
    expect(matchGuide([a, b], "/dashboard/m/land", "")?.slug).toBe("land/a");
  });
});

describe("openHref", () => {
  it("stops at the first wildcard and keeps value conditions", () => {
    expect(openHref(pattern("/dashboard/m/land/**"))).toBe("/dashboard/m/land");
    expect(openHref(pattern("/dashboard/m/land/*/zones"))).toBe("/dashboard/m/land");
    expect(openHref(pattern("/dashboard/m/email?rules=1&message"))).toBe(
      "/dashboard/m/email?rules=1",
    );
  });
});

describe("parseGuide", () => {
  it("reads the area a guide is grouped under, and null without one", () => {
    const withArea = parseGuide(
      "accounting/banking",
      [
        "# Banking",
        "",
        "> Cards.",
        "> **Route:** /dashboard/m/accounting/banking",
        "> **Order:** 10",
        "> **Area:** Banking",
        "",
        "Body.",
      ].join("\n"),
    );
    expect(withArea.area).toBe("Banking");
    const without = parseGuide(
      "land/overview",
      ["# Land", "", "> Ground.", "> **Route:** /dashboard/m/land/**", "", "Body."].join("\n"),
    );
    expect(without.area).toBeNull();
  });

  const raw = [
    "# Recording a delivery",
    "",
    "> What the screen is for, in a sentence.",
    "> **Route:** /dashboard/m/inventory/receipts/**, /dashboard/m/inventory?tab=receipts",
    "> **Order:** 20",
    "",
    "<!-- authoring note -->",
    "## Before you start",
    "",
    "Have the delivery note to hand.",
  ].join("\n");

  it("reads title, summary, order and routes from the header, and the body without it", () => {
    const parsed = parseGuide("inventory/receive-a-delivery", raw);
    expect(parsed.title).toBe("Recording a delivery");
    expect(parsed.summary).toBe("What the screen is for, in a sentence.");
    expect(parsed.order).toBe(20);
    expect(parsed.routes.map((route) => route.raw)).toEqual([
      "/dashboard/m/inventory/receipts/**",
      "/dashboard/m/inventory?tab=receipts",
    ]);
    expect(parsed.feature).toBe("inventory");
    expect(parsed.topic).toBe("receive-a-delivery");
    expect(parsed.content.startsWith("## Before you start")).toBe(true);
    expect(parsed.content).not.toContain("**Route:**");
  });

  it("falls back to the slug as title so a broken header is visible", () => {
    expect(parseGuide("land/overview", "no heading here\n").title).toBe("land/overview");
    expect(parseGuide("land/overview", "# X\n").order).toBe(100);
  });

  it("strips authoring comments from the body", () => {
    expect(parseGuide("inventory/x", raw).content).not.toContain("<!--");
  });
});

describe("vocabulary", () => {
  const definitions = [
    { key: "zone", fallback: "Zone" },
    { key: "enterprise", fallback: "Line of business", plural: "Lines of business" },
  ];

  it("replaces a placeholder with the tenant's word", () => {
    const vocabulary = buildVocabulary(definitions, { zone: "Paddock" });
    expect(applyLabels("Add a {{zone}}", vocabulary)).toBe("Add a Paddock");
  });

  it("uses the pack's word when nobody renamed it", () => {
    const vocabulary = buildVocabulary(definitions, {});
    expect(applyLabels("Add a {{zone}}", vocabulary)).toBe("Add a Zone");
  });

  it("pluralises a renamed word with an s and a fallback with its declared plural", () => {
    const renamed = buildVocabulary(definitions, { zone: "Paddock", enterprise: "Enterprise" });
    expect(applyLabels("{{zone|plural}} and {{enterprise|plural}}", renamed)).toBe(
      "Paddocks and Enterprises",
    );
    const untouched = buildVocabulary(definitions, {});
    expect(applyLabels("{{enterprise|plural}}", untouched)).toBe("Lines of business");
  });

  it("lowercases on request, alone or with the plural", () => {
    const vocabulary = buildVocabulary(definitions, { zone: "Paddock" });
    expect(applyLabels("a {{zone|lower}}, two {{zone|plural|lower}}", vocabulary)).toBe(
      "a paddock, two paddocks",
    );
  });

  it("leaves an unknown placeholder or modifier untouched", () => {
    const vocabulary = buildVocabulary(definitions, {});
    expect(applyLabels("{{paddock}} {{zone|upper}}", vocabulary)).toBe(
      "{{paddock}} {{zone|upper}}",
    );
    expect(placeholders("{{paddock}} {{zone|upper}}")).toEqual([
      { key: "paddock", modifiers: [] },
      { key: "zone", modifiers: ["upper"] },
    ]);
  });
});

describe("guideAreas", () => {
  const meta = (topic: string, order: number, area: string | null) => ({
    slug: `accounting/${topic}`,
    feature: "accounting",
    topic,
    title: topic,
    summary: "",
    order,
    routes: [],
    area,
  });

  it("captions a feature's guides by area in the order they appear, uncaptioned ones first", () => {
    const groups = guideAreas([
      meta("overview", 0, null),
      meta("banking", 10, "Banking"),
      meta("register", 20, "Banking"),
      meta("inbox", 30, "Inbox"),
      meta("rules", 40, "Banking"),
    ]);
    expect(groups.map((group) => [group.area, group.guides.map((guide) => guide.topic)])).toEqual([
      [null, ["overview"]],
      ["Banking", ["banking", "register", "rules"]],
      ["Inbox", ["inbox"]],
    ]);
  });

  it("puts the uncaptioned group first even when it comes late", () => {
    const groups = guideAreas([meta("a", 10, "Sales"), meta("b", 20, null)]);
    expect(groups.map((group) => group.area)).toEqual([null, "Sales"]);
  });
});

describe("control markers", () => {
  it("reads a button with its variant and icon, wherever the two sit", () => {
    const [marker] = controlMarkers("Click {button:New bill|primary|plus} to start.");
    expect(marker).toMatchObject({ kind: "button", label: "New bill", variant: "primary", icon: "plus", extra: [] });
    expect(marker.index).toBe(6);
    expect(marker.raw).toBe("{button:New bill|primary|plus}");
    expect(controlMarkers("{button:Save|plus|primary}")[0]).toMatchObject({ variant: "primary", icon: "plus" });
  });

  it("reads a badge, an icon and a key", () => {
    const seen = controlMarkers("{badge:Past due|destructive} {icon:calculator} {kbd:Ctrl+K}");
    expect(seen.map((m) => [m.kind, m.label, m.variant, m.icon])).toEqual([
      ["badge", "Past due", "destructive", null],
      ["icon", "calculator", null, null],
      ["kbd", "Ctrl+K", null, null],
    ]);
  });

  it("leaves a placeholder, an unknown kind and a bare word alone", () => {
    expect(controlMarkers("{{zone}} {field:Name} {button} {button:}")).toEqual([]);
  });

  it("names a modifier it cannot place and an icon nobody registered", () => {
    const icons = new Set(["plus"]);
    expect(controlMarkerProblem(controlMarkers("{badge:Paid|outline|big}")[0], icons)).toMatch(/cannot place/);
    expect(controlMarkerProblem(controlMarkers("{kbd:Ctrl+K|bold}")[0], icons)).toMatch(/cannot place/);
    expect(controlMarkerProblem(controlMarkers("{button:Save|rocket}")[0], icons)).toMatch(/icon/);
    expect(controlMarkerProblem(controlMarkers("{icon:rocket}")[0], icons)).toMatch(/icon/);
    expect(controlMarkerProblem(controlMarkers("{button:Save|primary|plus}")[0], icons)).toBeNull();
    expect(controlMarkerProblem(controlMarkers("{badge:Paid|success}")[0], icons)).toBeNull();
  });
});

describe("guideIndexFor", () => {
  const features = [
    { slug: "accounting", name: "Accounting", category: "core", icon: "calculator" },
    { slug: "land", name: "Land", category: "pack", icon: "map" },
  ];
  const guides = [
    guide("land/overview", "/dashboard/m/land/**"),
    guide("livestock/overview", "/dashboard/m/livestock/**"),
    guide("settings/billing", "/dashboard/billing"),
    guide("workspace/getting-around", "/dashboard"),
  ];

  it("lists fixed sections and features in rail order", () => {
    const sections = guideIndexFor(guides, features, {
      profileName: "Homestead Farm",
      isOwner: true,
    });
    expect(sections.map((section) => section.label)).toEqual([
      "Workspace",
      "Modules",
      "Homestead Farm",
      "Business",
      "Settings",
    ]);
    expect(
      guideIndexFor(guides, features, { profileName: null, isOwner: true })[2].label,
    ).toBe("Add-ons");
  });

  it("keeps an enabled feature with no guide, and drops guides for one that is not switched on", () => {
    const sections = guideIndexFor(guides, features, { profileName: null, isOwner: true });
    const modules = sections.find((section) => section.key === "modules");
    expect(modules?.groups.map((group) => [group.slug, group.guides.length])).toEqual([
      ["accounting", 0],
    ]);
    const listed = sections
      .flatMap((section) => section.groups)
      .flatMap((group) => group.guides.map((entry) => entry.slug));
    expect(listed).toContain("land/overview");
    expect(listed).not.toContain("livestock/overview");
  });

  it("hides settings from staff", () => {
    const sections = guideIndexFor(guides, features, { profileName: null, isOwner: false });
    expect(sections.map((section) => section.key)).not.toContain("settings");
  });

  it("puts overview first, then order, then title", () => {
    const sorted = sortGuides([
      { ...guide("land/zones"), title: "Zones", order: 10 },
      { ...guide("land/walk"), title: "A walk", order: 10 },
      { ...guide("land/overview"), title: "Zzz", order: 500 },
    ]);
    expect(sorted.map((entry) => entry.slug)).toEqual(["land/overview", "land/walk", "land/zones"]);
  });
});

describe("resolveDocLink", () => {
  it("rewrites sibling and parent-relative .md links, and leaves app and external links alone", () => {
    expect(resolveDocLink("land/overview", "zones.md")).toBe("land/zones");
    expect(resolveDocLink("land/overview", "../workspace/getting-around.md#sidebar")).toBe(
      "workspace/getting-around",
    );
    expect(resolveDocLink("briefs/x", "../decisions/0013-inventory-tax-treatment.md")).toBe(
      "decisions/0013-inventory-tax-treatment",
    );
    expect(resolveDocLink("land/overview", "/dashboard/m/land")).toBeNull();
    expect(resolveDocLink("land/overview", "https://example.com/x.md")).toBeNull();
    expect(resolveDocLink("land/overview", "#sidebar")).toBeNull();
    expect(resolveDocLink("land/overview", "../../escape.md")).toBeNull();
  });
});

describe("docs/help on disk", () => {
  const HELP = join(__dirname, "..", "docs", "help");

  /** Every guide file, hidden ones excluded — the walker's own rule. */
  const files = (dir = HELP): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) return [];
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return entry.name.endsWith(".md") ? [full] : [];
    });

  /**
   * A guide may quote the placeholder syntax itself — the Templates guide
   * shows `{{field_name}}` in backticks to teach it — so code spans are not
   * scanned. A known key inside backticks still resolves at render time
   * (`{{zone}} 7` on the site plan), which is why only the checks skip them.
   */
  const withoutCodeSpans = (text: string) => text.replace(/`[^`\n]*`/g, " ");

  it("every placeholder is a declared label key with a known modifier", () => {
    const declared = new Set(guideDefinitions().map((definition) => definition.key));
    for (const file of files()) {
      for (const placeholder of placeholders(withoutCodeSpans(readFileSync(file, "utf8")))) {
        expect(
          declared.has(placeholder.key),
          `${file} uses {{${placeholder.key}}}, which no feature declares`,
        ).toBe(true);
        for (const modifier of placeholder.modifiers) {
          expect(MODIFIERS.includes(modifier), `${file} uses |${modifier}`).toBe(true);
        }
      }
    }
  });

  it("every control marker names a known kind, variant and icon", () => {
    const icons = controlIconNames();
    // Placeholders resolve before the renderer sees a marker, so a label like
    // `{button:Add {{zone|lower}}|outline}` is scanned as the reader gets it;
    // unresolved, the braces inside would hide the marker from the grammar.
    const vocabulary = buildVocabulary(guideDefinitions(), {});
    for (const file of files()) {
      const text = applyLabels(readFileSync(file, "utf8"), vocabulary);
      for (const marker of controlMarkers(text)) {
        expect(controlMarkerProblem(marker, icons), file).toBeNull();
      }
    }
  });

  it("every accounting guide but the overview names the area it is grouped under", async () => {
    const guides = (await listGuides()).filter((guide) => guide.feature === "accounting");
    expect(guides.length).toBeGreaterThan(1);
    for (const guide of guides) {
      if (guide.topic === "overview") expect(guide.area).toBeNull();
      else expect(guide.area, `${guide.slug} has no **Area:**`).not.toBeNull();
    }
  });

  it("every folder is a feature slug or a fixed section", () => {
    const fixed = new Set(FIXED_SECTIONS.map((section) => section.key));
    for (const entry of readdirSync(HELP, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) {
        continue;
      }
      expect(
        fixed.has(entry.name) || entry.name in featureRegistry,
        `docs/help/${entry.name} is neither a feature nor a fixed section`,
      ).toBe(true);
    }
  });

  it("every guide has a real title, a summary and at least one valid route", async () => {
    const guides = await listGuides();
    expect(guides.length).toBeGreaterThan(0);
    for (const entry of guides) {
      expect(entry.title, entry.slug).not.toBe(entry.slug);
      expect(entry.summary, entry.slug).not.toBe("");
      expect(entry.routes.length, `${entry.slug} has no valid **Route:**`).toBeGreaterThan(0);
      expect(entry.feature, `${entry.slug} sits outside any folder`).not.toBe("");
    }
  });

  it("resolves the accounting sales screens to their own guides", async () => {
    const guides = await listGuides();
    const at = (pathname: string) => matchGuide(guides, pathname, "")?.slug ?? null;
    expect(at("/dashboard/m/accounting/sales")).toBe("accounting/invoices");
    expect(at("/dashboard/m/accounting/sales/invoices")).toBe("accounting/invoices");
    expect(at("/dashboard/m/accounting/sales/invoices/new")).toBe("accounting/new-invoice");
    expect(at("/dashboard/m/accounting/sales/invoices/abc")).toBe("accounting/invoice");
    expect(at("/dashboard/m/accounting/sales/customers")).toBe("accounting/customers");
    expect(at("/dashboard/m/accounting/sales/catalogue")).toBe("accounting/catalogue");
    expect(at("/dashboard/m/accounting/sales/reminders")).toBe("accounting/reminders");
  });

  it("resolves the accounting banking and ledger screens to their own guides", async () => {
    const guides = await listGuides();
    const at = (pathname: string) => matchGuide(guides, pathname, "")?.slug ?? null;
    expect(at("/dashboard/m/accounting/banking")).toBe("accounting/banking");
    expect(at("/dashboard/m/accounting/banking/abc")).toBe("accounting/register");
    expect(at("/dashboard/m/accounting/banking/abc/import")).toBe("accounting/import-statement");
    expect(at("/dashboard/m/accounting/banking/abc/reconcile")).toBe("accounting/reconcile");
    expect(at("/dashboard/m/accounting/banking/rules")).toBe("accounting/bank-rules");
    expect(at("/dashboard/m/accounting/accounts")).toBe("accounting/chart-of-accounts");
    expect(at("/dashboard/m/accounting/journal")).toBe("accounting/journal");
    expect(at("/dashboard/m/accounting/journal/new")).toBe("accounting/new-entry");
    expect(at("/dashboard/m/accounting/journal/abc")).toBe("accounting/entry");
    expect(at("/dashboard/m/accounting/trial-balance")).toBe("accounting/trial-balance");
  });

  it("resolves the accounting reports, close, companies and recurring screens to their own guides", async () => {
    const guides = await listGuides();
    const at = (path: string) => matchGuide(guides, path, "")?.slug;
    expect(at("/dashboard/m/accounting/reports")).toBe("accounting/reports");
    expect(at("/dashboard/m/accounting/reports/pnl")).toBe("accounting/profit-and-loss");
    expect(at("/dashboard/m/accounting/reports/balance-sheet")).toBe("accounting/balance-sheet");
    expect(at("/dashboard/m/accounting/reports/general-ledger")).toBe("accounting/general-ledger");
    expect(at("/dashboard/m/accounting/reports/cash")).toBe("accounting/cash-activity");
    expect(at("/dashboard/m/accounting/reports/ar-aging")).toBe("accounting/ar-aging");
    expect(at("/dashboard/m/accounting/reports/ap-aging")).toBe("accounting/ap-aging");
    expect(at("/dashboard/m/accounting/reports/sales-tax")).toBe("accounting/sales-tax");
    expect(at("/dashboard/m/accounting/close")).toBe("accounting/close");
    expect(at("/dashboard/m/accounting/close/abc")).toBe("accounting/close-record");
    expect(at("/dashboard/m/accounting/companies")).toBe("accounting/companies");
    expect(at("/dashboard/m/accounting/recurring")).toBe("accounting/recurring");
  });

  it("resolves every Documents screen to its own guide", async () => {
    const guides = await listGuides();
    const at = (pathname: string) => matchGuide(guides, pathname, "")?.slug ?? null;
    expect(at("/dashboard/m/documents")).toBe("documents/overview");
    expect(at("/dashboard/m/documents/browse")).toBe("documents/browse");
    // `documents/browse` and `documents/file` share the route; the earlier
    // slug wins and links onward, as Land's parcel and site-plan do.
    expect(at("/dashboard/m/documents/browse/abc")).toBe("documents/browse");
    expect(at("/dashboard/m/documents/inbox")).toBe("documents/inbox");
    expect(at("/dashboard/m/documents/search")).toBe("documents/search");
    expect(at("/dashboard/m/documents/tags")).toBe("documents/tags");
    expect(at("/dashboard/m/documents/templates")).toBe("documents/templates");
    expect(at("/dashboard/m/documents/templates/abc")).toBe("documents/template");
    expect(at("/dashboard/m/documents/shares")).toBe("documents/shares");
    expect(at("/dashboard/m/documents/trash")).toBe("documents/trash");
  });

  it("the template is not a guide", async () => {
    // Hidden files start with "_" or "."; a guide about templates is a guide.
    expect(
      (await listGuides()).some((entry) =>
        entry.slug.split("/").some((part) => part.startsWith("_") || part.startsWith(".")),
      ),
    ).toBe(false);
    expect(await getGuide("_TEMPLATE")).toBeNull();
  });

  it("resolves every Land screen to its own guide, and nothing for a screen with no guide", async () => {
    const guides = await listGuides();
    const at = (pathname: string) => matchGuide(guides, pathname, "")?.slug ?? null;
    expect(at("/dashboard")).toBe("workspace/getting-around");
    expect(at("/dashboard/today")).toBe("workspace/what-needs-you");
    expect(at("/dashboard/settings")).toBe("settings/business-settings");
    expect(at("/dashboard/settings/payments")).toBe("settings/taking-payments");
    expect(at("/dashboard/m/land")).toBe("land/parcels");
    // `land/parcel` and `land/site-plan` both declare `/dashboard/m/land/*`;
    // the tie goes to the earlier slug, and the parcel guide links onward.
    expect(at("/dashboard/m/land/abc")).toBe("land/parcel");
    expect(at("/dashboard/m/land/abc/zones/def")).toBe("land/zone");
    expect(at("/dashboard/m/land/find")).toBe("land/find-my-parcels");
    expect(at("/dashboard/m/accounting")).toBe("accounting/overview");
    expect(at("/dashboard/m/accounting/purchases")).toBe("accounting/bills");
    expect(at("/dashboard/m/accounting/purchases/bills")).toBe("accounting/bills");
    expect(at("/dashboard/m/accounting/purchases/bills/new")).toBe("accounting/new-bill");
    expect(at("/dashboard/m/accounting/purchases/bills/abc")).toBe("accounting/bill");
    expect(at("/dashboard/m/accounting/receipts/abc")).toBe("accounting/document");
    // A screen with no guide of its own falls back to the module overview (a
    // made-up path, so the line survives every area getting its own guides)…
    expect(at("/dashboard/m/accounting/no-such-screen")).toBe("accounting/overview");
    // …and a module with no guides at all gets nothing.
    expect(at("/dashboard/m/crm")).toBeNull();
  });

  it("reads a Land guide as paddocks for a homestead farm and zones for nobody in particular", async () => {
    const zone = await getGuide("land/zone");
    expect(zone).not.toBeNull();
    const farm = localiseGuide(zone!, guideVocabulary({ industry: "homestead-farm", labels: {} }));
    expect(farm.title).toContain("paddock");
    expect(farm.content).not.toContain("{{");
    const general = localiseGuide(zone!, guideVocabulary({ industry: "general", labels: {} }));
    expect(general.title).toContain("zone");
    // Every guide in the tree resolves fully for both vocabularies.
    for (const guide of await listGuides()) {
      expect(
        withoutCodeSpans(
          localiseGuide(guide, guideVocabulary({ industry: "homestead-farm", labels: {} })).content,
        ),
        guide.slug,
      ).not.toContain("{{");
    }
  });
});
