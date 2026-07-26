import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString as mdToString } from "mdast-util-to-string";
import { schema, withSystem, withTenant, type Tx } from "@/db";
import {
  createTemplate,
  listTemplates,
  listTemplateVersions,
  loadCurrentPublished,
  parseFields,
  publishDraft,
  saveDraft,
  setTemplateArchived,
} from "@/modules/documents/doc-templates/template-ops";
import {
  extractMergeFields,
  injectValues,
  isValidFieldName,
  missingFields,
  placeholderFor,
  type MdNode,
} from "@/modules/documents/doc-templates/merge";

/**
 * The merge engine. Pure, so these run everywhere.
 *
 * The injection tests are the point of this file. A merge value is content, not
 * syntax, and the only way to keep that true is to put it into the tree AFTER
 * parsing. Everything below is a way of asking "did a value manage to become
 * structure?" — and the answer must always be no.
 */

/** Parse real Markdown so the tests exercise a real mdast tree, not a mock. */
const parse = (src: string) => fromMarkdown(src) as unknown as MdNode;

/** Node types present anywhere in the tree — how we detect smuggled syntax. */
function typesIn(node: MdNode): string[] {
  const out: string[] = [node.type];
  for (const child of node.children ?? []) out.push(...typesIn(child));
  return out;
}

describe("merge field names", () => {
  it("accepts identifier-shaped names and rejects the rest", () => {
    expect(isValidFieldName("client_name")).toBe(true);
    expect(isValidFieldName("amount2")).toBe(true);
    expect(isValidFieldName("2amount")).toBe(false);
    expect(isValidFieldName("client name")).toBe(false);
    expect(isValidFieldName("client-name")).toBe(false);
    expect(isValidFieldName("")).toBe(false);
    expect(isValidFieldName("x".repeat(41))).toBe(false);
  });

  it("extracts distinct fields in the order a form should ask for them", () => {
    const source = "Dear {{client_name}}, re {{job}}. Regards, {{client_name}}.";
    expect(extractMergeFields(source)).toEqual(["client_name", "job"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(extractMergeFields("{{ amount }} and {{amount}}")).toEqual(["amount"]);
  });

  it("ignores things that only look like fields", () => {
    expect(extractMergeFields("{{ not-a-name }} {{2bad}} {{}} {single}")).toEqual(
      [],
    );
  });

  it("reports which fields a set of values fails to cover", () => {
    const source = "{{a}} {{b}} {{c}}";
    expect(missingFields(source, { a: "x", b: "  " })).toEqual(["b", "c"]);
    expect(missingFields(source, { a: "x", b: "y", c: "z" })).toEqual([]);
  });
});

describe("value injection", () => {
  it("replaces a placeholder with the value", () => {
    const tree = parse("Dear {{client_name}}, hello.");
    const count = injectValues(tree, { client_name: "Acme Roofing" });
    expect(count).toBe(1);
    expect(mdToString(tree as never)).toBe("Dear Acme Roofing, hello.");
  });

  /**
   * The headline case from the design note. A customer literally named
   * "# ACME" must appear as text, not become a heading.
   */
  it("cannot turn a value into a heading", () => {
    const tree = parse("Dear {{client_name}}, hello.");
    injectValues(tree, { client_name: "# ACME" });
    expect(typesIn(tree)).not.toContain("heading");
    expect(mdToString(tree as never)).toBe("Dear # ACME, hello.");
  });

  it("cannot turn a value into a link", () => {
    const tree = parse("Signed by {{signer}}.");
    injectValues(tree, { signer: "[click here](http://evil.example)" });
    expect(typesIn(tree)).not.toContain("link");
    expect(mdToString(tree as never)).toContain("[click here](http://evil.example)");
  });

  it("cannot turn a value into emphasis, an image, or a list", () => {
    const cases: Array<[string, string]> = [
      ["**shouty**", "strong"],
      ["*sly*", "emphasis"],
      ["![x](http://evil.example/x.png)", "image"],
      ["- one\n- two", "list"],
      ["> quoted", "blockquote"],
      ["`code`", "inlineCode"],
    ];
    for (const [value, forbidden] of cases) {
      const tree = parse("Name: {{name}}");
      injectValues(tree, { name: value });
      expect(typesIn(tree)).not.toContain(forbidden);
      expect(mdToString(tree as never)).toContain(value);
    }
  });

  /**
   * Splitting the SOURCE on placeholders and rendering the pieces separately
   * would break this — the bold would be left unterminated. Injecting into the
   * parsed tree keeps the surrounding structure intact.
   */
  it("preserves markup that spans the placeholder", () => {
    const tree = parse("**Hello {{name}}!**");
    injectValues(tree, { name: "Dan" });
    expect(typesIn(tree)).toContain("strong");
    expect(mdToString(tree as never)).toBe("Hello Dan!");
  });

  it("fills every occurrence and counts each one", () => {
    const tree = parse("{{a}} then {{a}} then {{b}}");
    const count = injectValues(tree, { a: "1", b: "2" });
    expect(count).toBe(3);
    expect(mdToString(tree as never)).toBe("1 then 1 then 2");
  });

  it("leaves placeholders inside code samples alone", () => {
    // A template documenting its own syntax is showing the placeholder, not
    // using it.
    const tree = parse("Use `{{amount}}` like this.");
    const count = injectValues(tree, { amount: "500" });
    expect(count).toBe(0);
    expect(mdToString(tree as never)).toContain("{{amount}}");
  });

  it("shows an obvious placeholder rather than a silent gap", () => {
    const tree = parse("Received from {{payer}} the sum of {{amount}}.");
    injectValues(tree, { payer: "   " });
    const text = mdToString(tree as never);
    // Neither an empty hole nor a lie — both read as "still needs filling in".
    expect(text).toBe(
      `Received from ${placeholderFor("payer")} the sum of ${placeholderFor("amount")}.`,
    );
  });

  it("works across block structure, not just one paragraph", () => {
    const tree = parse("# {{title}}\n\n- item {{n}}\n\n> from {{who}}");
    const count = injectValues(tree, { title: "Waiver", n: "1", who: "Dan" });
    expect(count).toBe(3);
    // The template's OWN structure survives — it is the values that cannot
    // create structure.
    expect(typesIn(tree)).toContain("heading");
    expect(typesIn(tree)).toContain("list");
    expect(typesIn(tree)).toContain("blockquote");
    expect(mdToString(tree as never)).toContain("Waiver");
    expect(mdToString(tree as never)).toContain("from Dan");
  });

  it("is a no-op on a tree with no placeholders", () => {
    const tree = parse("Nothing to merge here.");
    expect(injectValues(tree, { unused: "x" })).toBe(0);
    expect(mdToString(tree as never)).toBe("Nothing to merge here.");
  });
});

/* ------------------------------------------------------------------------
 * Template storage against the database (0033/0034).
 *
 * The invariant worth the round trip is publish immutability: a published
 * version's body must never change, and "at most one draft" must be the
 * DATABASE's answer rather than a convention this file happens to follow.
 * ---------------------------------------------------------------------- */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const STAMP_TPL = `dms-tpl-${process.pid}`;

d("template storage", () => {
  let tenantId: string;
  const ctx = { tenantId: "", userId: "user-tpl", role: "owner" as const };

  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner" });

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP_TPL, name: "DMS Tpl", slug: STAMP_TPL })
        .returning();
      return row.id;
    });
    ctx.tenantId = tenantId;
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("creates a template with an editable v1 draft", async () => {
    const created = await asOwner((tx) =>
      createTemplate(tx, ctx, {
        name: "Lien Waiver",
        body: "Received from {{payer}} the sum of {{amount}}.",
      }),
    );
    expect(created.template.nameKey).toBe("lien waiver");
    expect(created.draft.versionNo).toBe(1);
    expect(created.draft.publishedAt).toBeNull();
    // Fields are DERIVED from the body, so they cannot promise a field the
    // document never fills.
    expect(parseFields(created.draft.fields).map((f) => f.name)).toEqual([
      "payer",
      "amount",
    ]);
    expect(parseFields(created.draft.fields)[0].label).toBe("Payer");
  });

  it("refuses a duplicate name case-insensitively", async () => {
    await asOwner((tx) => createTemplate(tx, ctx, { name: "Change Order" }));
    await expect(
      asOwner((tx) => createTemplate(tx, ctx, { name: "  change order  " })),
    ).rejects.toMatchObject({ code: "TEMPLATE_NAME_TAKEN" });
  });

  /** The rule the whole feature is built around. */
  it("freezes a published version and starts a new draft on the next edit", async () => {
    const { template } = await asOwner((tx) =>
      createTemplate(tx, ctx, { name: "Frozen", body: "Version one {{who}}" }),
    );

    const published = await asOwner((tx) =>
      publishDraft(tx, ctx, { templateId: template.id }),
    );
    expect(published.versionNo).toBe(1);
    expect(published.publishedAt).not.toBeNull();
    expect(published.publishedByClerkUserId).toBe("user-tpl");

    // Editing does NOT touch v1 — it opens v2.
    const draft = await asOwner((tx) =>
      saveDraft(tx, ctx, { templateId: template.id, body: "Version two {{who}}" }),
    );
    expect(draft.versionNo).toBe(2);
    expect(draft.publishedAt).toBeNull();

    const versions = await asOwner((tx) =>
      listTemplateVersions(tx, tenantId, template.id),
    );
    const v1 = versions.find((v) => v.versionNo === 1)!;
    // The published body is byte-for-byte what it was.
    expect(v1.body).toBe("Version one {{who}}");
    expect(versions).toHaveLength(2);
  });

  it("keeps editing the same draft rather than forking it", async () => {
    const { template } = await asOwner((tx) =>
      createTemplate(tx, ctx, { name: "One Draft", body: "a" }),
    );
    await asOwner((tx) =>
      saveDraft(tx, ctx, { templateId: template.id, body: "b" }),
    );
    await asOwner((tx) =>
      saveDraft(tx, ctx, { templateId: template.id, body: "c" }),
    );
    const versions = await asOwner((tx) =>
      listTemplateVersions(tx, tenantId, template.id),
    );
    expect(versions).toHaveLength(1);
    expect(versions[0].body).toBe("c");
  });

  /**
   * "At most one draft" must be the DATABASE's answer, not a convention. A
   * second unpublished row for the same template has to be refused outright.
   */
  it("makes one-draft-per-template a database invariant", async () => {
    const { template } = await asOwner((tx) =>
      createTemplate(tx, ctx, { name: "Invariant", body: "x" }),
    );
    await expect(
      asOwner((tx) =>
        tx.insert(schema.documentTemplateVersions).values({
          tenantId,
          templateId: template.id,
          versionNo: 99,
          body: "sneaky second draft",
          createdByClerkUserId: "user-tpl",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses to publish nothing, or to publish twice", async () => {
    const { template } = await asOwner((tx) =>
      createTemplate(tx, ctx, { name: "Empty Publish", body: "   " }),
    );
    await expect(
      asOwner((tx) => publishDraft(tx, ctx, { templateId: template.id })),
    ).rejects.toMatchObject({ code: "TEMPLATE_BODY_EMPTY" });

    await asOwner((tx) =>
      saveDraft(tx, ctx, { templateId: template.id, body: "real content" }),
    );
    await asOwner((tx) => publishDraft(tx, ctx, { templateId: template.id }));
    // Nothing left unpublished.
    await expect(
      asOwner((tx) => publishDraft(tx, ctx, { templateId: template.id })),
    ).rejects.toMatchObject({ code: "TEMPLATE_NO_DRAFT" });
  });

  it("keeps edited labels but never a field the body dropped", async () => {
    const { template } = await asOwner((tx) =>
      createTemplate(tx, ctx, { name: "Labels", body: "{{amount}} {{payer}}" }),
    );
    await asOwner((tx) =>
      saveDraft(tx, ctx, {
        templateId: template.id,
        body: "{{amount}} {{payer}}",
        fields: [
          { name: "amount", label: "Amount in dollars", required: true },
          { name: "payer", label: "Who paid", required: false },
        ],
      }),
    );
    // Drop one field from the body; its label goes with it.
    const draft = await asOwner((tx) =>
      saveDraft(tx, ctx, { templateId: template.id, body: "{{amount}} only" }),
    );
    const fields = parseFields(draft.fields);
    expect(fields.map((f) => f.name)).toEqual(["amount"]);
    expect(fields[0].label).toBe("Amount in dollars");
  });

  it("reports the newest published version as the current one", async () => {
    const { template } = await asOwner((tx) =>
      createTemplate(tx, ctx, { name: "Current", body: "one" }),
    );
    await asOwner((tx) => publishDraft(tx, ctx, { templateId: template.id }));
    await asOwner((tx) =>
      saveDraft(tx, ctx, { templateId: template.id, body: "two" }),
    );
    // A draft exists but is not published, so v1 is still what generation uses.
    let current = await asOwner((tx) =>
      loadCurrentPublished(tx, tenantId, template.id),
    );
    expect(current!.body).toBe("one");

    await asOwner((tx) => publishDraft(tx, ctx, { templateId: template.id }));
    current = await asOwner((tx) =>
      loadCurrentPublished(tx, tenantId, template.id),
    );
    expect(current!.body).toBe("two");
    expect(current!.versionNo).toBe(2);
  });

  it("archives rather than deletes, and refuses a stale version", async () => {
    const { template } = await asOwner((tx) =>
      createTemplate(tx, ctx, { name: "Archive Me", body: "x" }),
    );
    const archived = await asOwner((tx) =>
      setTemplateArchived(tx, ctx, {
        templateId: template.id,
        expectedVersion: template.version,
        archived: true,
      }),
    );
    expect(archived.archivedAt).not.toBeNull();
    // Still there — a generated document naming it must not dangle.
    const all = await asOwner((tx) => listTemplates(tx, tenantId));
    expect(all.some((t) => t.id === template.id)).toBe(true);

    await expect(
      asOwner((tx) =>
        setTemplateArchived(tx, ctx, {
          templateId: template.id,
          expectedVersion: template.version,
          archived: false,
        }),
      ),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
  });
});
