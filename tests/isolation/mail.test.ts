import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { recentCorrespondents } from "../../src/modules/email/contacts/recent";
import { accountingMailExtension } from "../../src/modules/accounting/mail/extension";
import { d, seedParty } from "./_shared";

/**
 * Mail (the inbox): RLS for the seven tables the email module owns.
 *
 * Three different shapes get certified here, because 0042 gives them three
 * different policies for three different reasons:
 *
 *   - member_read tables (mailbox_domains, mailboxes, mail_directory_accounts,
 *     mail_accounts, mail_thread_index) — readable within the tenant, writable
 *     only by trusted server code. A member who could write any of them could
 *     assert something untrue about the outside world: a cutover that never
 *     happened, a password hash on a colleague's address, a token they control.
 *   - member-writable tables (mail_links, mail_annotations) — the deliberate
 *     exception, because attaching a thread to an invoice is daily work.
 *   - composite tenant FKs, which must refuse a cross-tenant target even when
 *     the row's own tenant_id passes RLS.
 *
 * The single most valuable assertion in this block is that tenant A cannot read
 * tenant B's stored OAuth token. That row is a live credential to somebody's
 * mail.
 */
const STAMP_MAIL = `iso-mail-${process.pid}`;

interface MailFixture {
  domainId: string;
  mailboxId: string;
  directoryId: string;
  accountId: string;
  threadRowId: string;
}

/** A second person inside tenant A — the colleague who must see nothing. */

/** A second person inside tenant A — the colleague who must see nothing. */
const COLLEAGUE = "user-a-colleague";

d("mail isolation (RLS + composite tenant FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  let colleagueAccountId: string;
  const fx: Record<string, MailFixture> = {};

  /** Seeded under withSystem: members cannot write most of these by design. */
  async function seedMail(tenantId: string, tag: string): Promise<MailFixture> {
    return withSystem(async (tx) => {
      const [domain] = await tx
        .insert(schema.mailboxDomains)
        .values({
          tenantId,
          domain: `${tag}-${STAMP_MAIL}.example`,
          provider: "stalwart",
          status: "pending",
        })
        .returning();
      const [mailbox] = await tx
        .insert(schema.mailboxes)
        .values({
          tenantId,
          mailboxDomainId: domain.id,
          localPart: tag,
          address: `${tag}@${tag}-${STAMP_MAIL}.example`,
          displayName: `Owner ${tag}`,
          status: "active",
        })
        .returning();
      const [directory] = await tx
        .insert(schema.mailDirectoryAccounts)
        .values({
          tenantId,
          mailboxId: mailbox.id,
          login: `${tag}@${tag}-${STAMP_MAIL}.example`,
          passwordHash: `$argon2id$secret-of-${tag}`,
        })
        .returning();
      const [account] = await tx
        .insert(schema.mailAccounts)
        .values({
          tenantId,
          mailboxId: mailbox.id,
          clerkUserId: `user-${tag}`,
          jmapSessionUrl: "https://mail.example/.well-known/jmap",
          jmapAccountId: `acct-${tag}`,
          accessTokenEnc: `ciphertext-token-of-${tag}`,
          refreshTokenEnc: `ciphertext-refresh-of-${tag}`,
        })
        .returning();
      const [threadRow] = await tx
        .insert(schema.mailThreadIndex)
        .values({
          tenantId,
          mailAccountId: account.id,
          threadId: `thread-${tag}`,
          subject: `secret subject of ${tag}`,
        })
        .returning();
      await tx.insert(schema.mailLinks).values({
        tenantId,
        // 0045: a thread id is only unique inside one mail account, so the
        // account is part of the link's identity.
        mailAccountId: account.id,
        threadId: `thread-${tag}`,
        extensionSlug: "documents",
        entityType: "document",
        // Any uuid: the table carries no FK on entity_id on purpose, so a
        // future layer can contribute a type without a migration.
        entityId: domain.id,
        createdByClerkUserId: `user-${tag}`,
      });
      await tx.insert(schema.mailAnnotations).values({
        tenantId,
        threadId: `thread-${tag}`,
        extensionSlug: "documents",
        data: { note: `annotation of ${tag}` },
      });
      // An auto-filing rule: per-user (drizzle/0058), so the colleague must NOT
      // see it — the opposite of the template seeded below.
      await tx.insert(schema.mailAutofileRules).values({
        tenantId,
        clerkUserId: `user-${tag}`,
        mailAccountId: account.id,
        name: `Supplier invoices ${tag}`,
        matchFrom: `supplier-${tag}.example`,
        cursor: new Date(),
      });
      // A canned response. The first mail table scoped to the BUSINESS rather
      // than to one person (drizzle/0056) — so unlike everything else seeded
      // here, the colleague is supposed to see it.
      await tx.insert(schema.mailTemplates).values({
        tenantId,
        name: `Payment terms ${tag}`,
        nameKey: `payment terms ${tag}`,
        subject: `Our terms ${tag}`,
        bodyHtml: `<p>Terms of ${tag}</p>`,
        createdByClerkUserId: `user-${tag}`,
      });
      return {
        domainId: domain.id,
        mailboxId: mailbox.id,
        directoryId: directory.id,
        accountId: account.id,
        threadRowId: threadRow.id,
      };
    });
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_MAIL}-a`, name: "Mail Iso A", slug: `${STAMP_MAIL}-a` },
          { clerkOrgId: `${STAMP_MAIL}-b`, name: "Mail Iso B", slug: `${STAMP_MAIL}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seedMail(tenantA, "a");
    fx.b = await seedMail(tenantB, "b");

    // A second person in tenant A, for the per-user tests below. Created here
    // rather than inside a test so the block does not depend on `it` order.
    const [colleague] = await withSystem((tx) =>
      tx
        .insert(schema.mailAccounts)
        .values({
          tenantId: tenantA,
          mailboxId: fx.a.mailboxId,
          clerkUserId: COLLEAGUE,
          jmapSessionUrl: "https://mail.example/.well-known/jmap",
          jmapAccountId: "acct-colleague",
          accessTokenEnc: "ciphertext-token-of-colleague",
        })
        .returning(),
    );
    colleagueAccountId = colleague.id;
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("unscoped selects on every mail table return only the tenant's rows", async () => {
    // The user id is required for the two per-user tables (0043); the other
    // five are tenant-scoped and ignore it.
    await withTenant(
      tenantA,
      async (tx) => {
        const tables = [
          await tx.select().from(schema.mailboxDomains),
          await tx.select().from(schema.mailboxes),
          await tx.select().from(schema.mailDirectoryAccounts),
          await tx.select().from(schema.mailAccounts),
          await tx.select().from(schema.mailThreadIndex),
          await tx.select().from(schema.mailLinks),
          await tx.select().from(schema.mailAnnotations),
          await tx.select().from(schema.mailTemplates),
          await tx.select().from(schema.mailAutofileRules),
        ];
        for (const rows of tables) {
          expect(rows.length).toBeGreaterThan(0);
          expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
        }
      },
      { userId: "user-a" },
    );
  });

  it("cannot read the other tenant's stored OAuth token", async () => {
    // That row is a live credential to somebody's mail. Encryption is what
    // makes the residual exposure uninteresting; this proves it never arrives.
    const rows = await withTenant(
      tenantA,
      (tx) =>
        tx
          .select()
          .from(schema.mailAccounts)
          .where(eq(schema.mailAccounts.id, fx.b.accountId)),
      { userId: "user-a" },
    );
    expect(rows).toHaveLength(0);
  });

  // ── Per-user isolation INSIDE one tenant (drizzle/0043) ──────────────────
  //
  // The rest of this file asks "can tenant A read tenant B?". These four ask
  // the question the inbox actually turns on: can one employee read a
  // COLLEAGUE'S mail? Same tenant, same RLS context, different person. Before
  // 0043 the answer was "only because the application remembered to filter".

  it("a colleague in the SAME tenant cannot read another user's connection", async () => {
    // Deliberately NO where clause on clerk_user_id — the forgotten-predicate
    // scenario this policy exists for.
    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailAccounts),
      { userId: "user-a" },
    );
    expect(asOwner.every((r) => r.clerkUserId === "user-a")).toBe(true);
    expect(asOwner.some((r) => r.id === colleagueAccountId)).toBe(false);

    // And the colleague sees theirs, so this is scoping rather than breakage.
    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailAccounts),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(1);
    expect(asColleague[0].id).toBe(colleagueAccountId);
  });

  it("omitting the user id reads NOTHING, not everything", async () => {
    // The direction that matters: a caller who forgets `{ userId }` must be
    // denied, never granted. Same property app.tenant_role was built with.
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailAccounts),
    );
    expect(rows).toHaveLength(0);
  });

  it("a colleague cannot read another user's thread subjects", async () => {
    // mail_thread_index has no clerk_user_id of its own — it inherits scope
    // through mail_accounts. This proves the EXISTS in 0043 actually composes.
    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailThreadIndex),
      { userId: "user-a" },
    );
    expect(asOwner.length).toBeGreaterThan(0);
    expect(asOwner.every((r) => r.threadId === "thread-a")).toBe(true);

    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailThreadIndex),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(0);

    const asNobody = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailThreadIndex),
    );
    expect(asNobody).toHaveLength(0);
  });

  /**
   * DELEGATION — a shared mailbox, two people, one set of policies.
   *
   * The founding property of this module was "your mail is yours", enforced by
   * scoping five tables to one person. A shared `info@` looks like it must
   * break that, and the finding of the delegation slice is that it does not:
   * **the property becomes "your ACCESS is yours"**. Each person who is granted
   * the box gets their OWN `mail_accounts` row with their OWN token and their
   * OWN JMAP account id, so everything hanging off `mail_account_id` stays
   * per-person while the MAIL — which lives on the mail server — is genuinely
   * shared.
   *
   * The fixture above already builds exactly that shape: `user-a` and
   * `COLLEAGUE` are both connected to `fx.a.mailboxId`. These assertions name
   * the property rather than leaving it as a side effect of a fixture, because
   * a future migration that "tidied up" the unique index to one row per mailbox
   * would pass every other test in this file and silently make a shared mailbox
   * impossible to connect twice.
   */
  /**
   * TEMPLATES GO THE OTHER WAY, and that is the point of asserting it.
   *
   * Every other mail table is per-user, and the tests above prove a colleague
   * sees nothing. `mail_templates` is tenant-scoped (drizzle/0056) because a
   * canned response is the business's boilerplate rather than somebody's
   * correspondence — so the SAME query that must return nothing for a snooze
   * must return the row for a template. A test that only ever asserts "the
   * colleague sees nothing" would pass just as well if the policy were broken
   * shut, and a template nobody else can read is the feature not working.
   */
  it("a colleague CAN read the business's templates", async () => {
    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailTemplates),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(1);
    expect(asColleague[0].name).toBe("Payment terms a");
    // …and it is genuinely tenant-scoped, not simply unprotected.
    expect(asColleague.every((r) => r.tenantId === tenantA)).toBe(true);
  });

  it("templates are readable WITHOUT a user id, unlike every per-user table", async () => {
    // The per-user tables fail closed when `{ userId }` is omitted. This one
    // must not, because nothing about it is per-user — and a loader that
    // silently returned an empty list would look exactly like a business with
    // no templates yet.
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailTemplates),
    );
    expect(rows).toHaveLength(1);
  });

  it("but a template still never crosses a tenant", async () => {
    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailTemplates),
      { userId: "user-a" },
    );
    expect(rows.some((r) => r.name === "Payment terms b")).toBe(false);
  });

  it("refuses two templates with the same folded name in one tenant", async () => {
    // The unique index is on `name_key`, so "Payment terms" and "payment  TERMS"
    // collide — the action reports it, and this is what guarantees it when two
    // people save at once.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailTemplates).values({
          tenantId: tenantA,
          name: "PAYMENT   terms   A",
          nameKey: "payment terms a",
          subject: "",
          bodyHtml: "<p>duplicate</p>",
          createdByClerkUserId: "user-a",
        }),
      ),
    ).rejects.toThrow();
  });

  /**
   * AUTO-FILING RULES — the sixth per-user table, and the one whose WRITE side
   * matters most.
   *
   * A forged row would make the sweep — which runs under `withSystem`, where
   * RLS is not standing behind it — copy a COLLEAGUE'S mail into a shared
   * Documents folder, on a schedule, with nobody watching. That is a disclosure
   * rather than a data error, and the policy is the only thing preventing it.
   */
  it("a colleague can neither read nor forge an auto-filing rule", async () => {
    const [mine] = await withSystem((tx) =>
      tx
        .insert(schema.mailAutofileRules)
        .values({
          tenantId: tenantA,
          clerkUserId: "user-a",
          mailAccountId: fx.a.accountId,
          name: "Supplier invoices",
          matchFrom: "supplier.example",
          cursor: new Date(),
        })
        .returning(),
    );

    // Invisible to the colleague, with no predicate of the app's.
    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailAutofileRules),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(0);

    // Visible to its owner, so this is scoping rather than breakage.
    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailAutofileRules),
      { userId: "user-a" },
    );
    expect(asOwner.map((r) => r.id)).toContain(mine.id);

    // And a caller who forgets `{ userId }` reads nothing, not everything.
    const asNobody = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailAutofileRules),
    );
    expect(asNobody).toHaveLength(0);

    // THE WRITE SIDE: a member cannot attribute a rule to a colleague, which is
    // what would make the sweep publish that colleague's mail.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.mailAutofileRules).values({
            tenantId: tenantA,
            clerkUserId: "user-a",
            mailAccountId: fx.a.accountId,
            name: "Forged",
            matchFrom: "anything",
          }),
        { userId: COLLEAGUE },
      ),
    ).rejects.toThrow();

    await withSystem((tx) =>
      tx.delete(schema.mailAutofileRules).where(eq(schema.mailAutofileRules.id, mine.id)),
    );
  });

  it("deleting a Documents folder NULLS the destination instead of failing", async () => {
    /**
     * The composite FK from drizzle/0058, and the reason it is hand-written.
     *
     * A plain `ON DELETE SET NULL` on a composite key nulls EVERY column,
     * `tenant_id` included — which is NOT NULL, so deleting a folder would fail
     * outright for any tenant with a rule pointing at it. Tidying the cabinet
     * would start erroring and the cause would be a mail feature nobody was
     * thinking about. The column-list form is what makes this pass.
     */
    const folderId = await withSystem(async (tx) => {
      const [folder] = await tx
        .insert(schema.documentFolders)
        .values({
          tenantId: tenantA,
          parentId: null,
          name: `Autofile dest ${STAMP_MAIL}`,
          nameKey: `autofile dest ${STAMP_MAIL}`,
          // Placeholder, then rewritten below: `path` must contain the folder's
          // OWN id (document_folders_path_format), which is not known until the
          // insert returns. Same two-step the DMS fixture uses.
          path: "/00000000000000000000000000000002/",
          depth: 1,
          createdByClerkUserId: "user-a",
        })
        .returning();
      await tx
        .update(schema.documentFolders)
        .set({ path: `/${folder.id.replace(/-/g, "").toLowerCase()}/` })
        .where(eq(schema.documentFolders.id, folder.id));
      await tx.insert(schema.mailAutofileRules).values({
        tenantId: tenantA,
        clerkUserId: "user-a",
        mailAccountId: fx.a.accountId,
        name: "Files into a folder",
        matchFrom: "supplier.example",
        destinationFolderId: folder.id,
      });
      return folder.id;
    });

    // The delete must SUCCEED — that is the whole assertion.
    await withSystem((tx) =>
      tx.delete(schema.documentFolders).where(eq(schema.documentFolders.id, folderId)),
    );

    const after = await withSystem((tx) =>
      tx
        .select()
        .from(schema.mailAutofileRules)
        .where(eq(schema.mailAutofileRules.name, "Files into a folder")),
    );
    expect(after).toHaveLength(1);
    // The rule survives and degrades to "the Documents inbox" — somebody
    // deleted a folder, they did not ask to stop filing.
    expect(after[0].destinationFolderId).toBe(null);
    expect(after[0].tenantId).toBe(tenantA);

    await withSystem((tx) =>
      tx.delete(schema.mailAutofileRules).where(eq(schema.mailAutofileRules.id, after[0].id)),
    );
  });

  it("two people can connect the SAME mailbox, each with their own row", async () => {
    const rows = await withSystem((tx) =>
      tx
        .select()
        .from(schema.mailAccounts)
        .where(eq(schema.mailAccounts.mailboxId, fx.a.mailboxId)),
    );
    const users = rows.map((r) => r.clerkUserId).sort();
    expect(users).toEqual(["user-a", COLLEAGUE].sort());
    // Different tokens and different JMAP accounts: nobody is sharing a
    // credential, which is the entire point of delegation over a password.
    expect(new Set(rows.map((r) => r.accessTokenEnc)).size).toBe(2);
  });

  it("a delegated connection does not let a colleague read your rows for it", async () => {
    // The sharp version of the per-user tests above: same tenant, same MAILBOX,
    // different person. Sharing a mailbox must not share the snoozes, saved
    // searches, rules or scheduled sends somebody keeps against it.
    const asOwner = await withTenant(
      tenantA,
      (tx) =>
        tx
          .select()
          .from(schema.mailAccounts)
          .where(eq(schema.mailAccounts.mailboxId, fx.a.mailboxId)),
      { userId: "user-a" },
    );
    expect(asOwner).toHaveLength(1);
    expect(asOwner[0].clerkUserId).toBe("user-a");

    const asColleague = await withTenant(
      tenantA,
      (tx) =>
        tx
          .select()
          .from(schema.mailAccounts)
          .where(eq(schema.mailAccounts.mailboxId, fx.a.mailboxId)),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(1);
    expect(asColleague[0].clerkUserId).toBe(COLLEAGUE);
  });

  it("the same mailbox cannot be connected twice by ONE person", async () => {
    // The other half of the index: one row per (tenant, mailbox, user).
    // Reconnecting replaces the tokens; it must never accumulate rows, or a
    // stale token would go on being used alongside a fresh one.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailAccounts).values({
          tenantId: tenantA,
          mailboxId: fx.a.mailboxId,
          clerkUserId: COLLEAGUE,
          jmapSessionUrl: "https://mail.example/.well-known/jmap",
          jmapAccountId: "acct-colleague-again",
          accessTokenEnc: "ciphertext-duplicate",
        }),
      ),
    ).rejects.toThrow();
  });

  /**
   * Recipient autocomplete, over the same per-user scope.
   *
   * THE PRIVACY FAILURE THIS RULES OUT is specific and easy to ship by accident:
   * an autocomplete that offered a colleague's correspondents would leak WHO
   * SOMEBODY ELSE WRITES TO, from a feature nobody thinks of as sensitive. It is
   * the same class of leak `mail_thread_index`'s policy exists for — a subject
   * line in a colleague's thread list is already too much — and it is reached
   * here through a different door, so it deserves its own assertion.
   *
   * `recentCorrespondents` has no user predicate of its own. What scopes it is
   * the `withTenant(..., { userId })` the action passes, and RLS.
   */
  it("recipient suggestions never offer a colleague's correspondents", async () => {
    // Seeded under withSystem, and that is itself worth noticing:
    // `mail_thread_index` is member-READ only, so a member update is silently
    // refused. Sync writes it as trusted code, which is exactly why a member
    // cannot forge a correspondent into somebody's suggestions.
    await withSystem((tx) =>
      tx
        .update(schema.mailThreadIndex)
        .set({
          participants: [{ name: "A Supplier", email: "supplier-iso@example.com" }],
        })
        .where(eq(schema.mailThreadIndex.id, fx.a.threadRowId)),
    );

    const mine = await withTenant(
      tenantA,
      (tx) => recentCorrespondents(tx, tenantA, "supplier-iso", 10),
      { userId: "user-a" },
    );
    expect(mine.map((c) => c.email)).toContain("supplier-iso@example.com");

    const theirs = await withTenant(
      tenantA,
      (tx) => recentCorrespondents(tx, tenantA, "supplier-iso", 10),
      { userId: COLLEAGUE },
    );
    expect(theirs).toEqual([]);

    // The fail-closed direction: a caller that forgets `userId` gets NOTHING
    // rather than everything, which is what `app_current_user()` returning NULL
    // is for.
    const anonymous = await withTenant(tenantA, (tx) =>
      recentCorrespondents(tx, tenantA, "supplier-iso", 10),
    );
    expect(anonymous).toEqual([]);
  });

  /**
   * The contact SEAM, over Accounting's customers.
   *
   * `extension.ts` joins the customer to its party's contact points and filters
   * on tenant and nothing else, so this asserts that the CALLER'S transaction is
   * what keeps one tenant's customers out of another's recipient field — the
   * same property the image source is tested for, reached through the other
   * capability. Since 0075 the address is on the PARTY, which puts a second
   * tenant-scoped table inside the same query and makes this worth more than it
   * was: RLS has to hold on both sides of that join.
   */
  it("the contact source cannot reach another tenant's customers", async () => {
    for (const [tenant, tag] of [
      [tenantA, "a"],
      [tenantB, "b"],
    ] as const) {
      await withTenant(
        tenant,
        async (tx) => {
          const partyId = await seedParty(tx, tenant, `Isolation Contact ${tag}`);
          await tx.insert(schema.partyContactPoints).values({
            tenantId: tenant,
            partyId,
            kind: "email",
            value: `isolation-contact@${tag}.example`,
            normalizedValue: `isolation-contact@${tag}.example`,
            isPrimary: true,
          });
          return tx.insert(schema.customers).values({
            tenantId: tenant,
            partyId,
            name: `Isolation Contact ${tag}`,
          });
        },
        { role: "owner", userId: `user-${tag}` },
      );
    }

    const fromA = await withTenant(
      tenantA,
      (tx) =>
        accountingMailExtension.contacts!.search(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          "isolation-contact",
          10,
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(fromA.map((c) => c.email)).toEqual(["isolation-contact@a.example"]);

    const fromB = await withTenant(
      tenantB,
      (tx) =>
        accountingMailExtension.contacts!.search(
          tx,
          { tenantId: tenantB, userId: "user-b", role: "owner" },
          "isolation-contact",
          10,
        ),
      { role: "owner", userId: "user-b" },
    );
    expect(fromB.map((c) => c.email)).toEqual(["isolation-contact@b.example"]);
  });

  /**
   * FINDING A CUSTOMER BY ITS ADDRESS, which after 0075 is an `EXISTS` against
   * `party_contact_points` written as raw SQL rather than an `ilike` on a
   * column. Two things are asserted and both are worth the test:
   *
   *  - it works at all. Hand-written SQL that has never run is exactly what
   *    ships broken, and no other test reaches this predicate.
   *  - RLS holds INSIDE the subquery. A positive existence test can only ever
   *    be narrowed by rows the caller cannot see, which is the opposite of the
   *    `NOT EXISTS` failure `crm_affiliations` documents — but "it follows from
   *    the shape" is how the affiliation bug would have been argued too.
   */
  it("a customer is findable by an address on its party, and only its own tenant's", async () => {
    const customerType = accountingMailExtension.entityTypes.find(
      (t) => t.type === "customer",
    )!;

    const fromA = await withTenant(
      tenantA,
      (tx) =>
        customerType.search(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          // The address only — nothing in the NAME matches this, so a hit can
          // only have come through the contact-point subquery.
          "isolation-contact@a.example",
          10,
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(fromA.map((e) => e.label)).toEqual(["Isolation Contact a"]);
    expect(fromA[0].sublabel).toBe("isolation-contact@a.example");

    // Tenant B's address, asked for by tenant A. The role row is invisible and
    // so is the contact point; neither half may answer.
    const crossTenant = await withTenant(
      tenantA,
      (tx) =>
        customerType.search(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          "isolation-contact@b.example",
          10,
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(crossTenant).toEqual([]);
  });

  /**
   * TEMPLATE PLACEHOLDER VALUES, reached through the newest capability.
   *
   * `{{invoice.number}}` pastes a business record's fields into a message
   * somebody is about to send OUTSIDE the business, so "which records can a
   * template read?" is the question this certifies. `templateValues` takes the
   * CALLER'S `tx` like every other hook and applies no visibility predicate of
   * its own — it filters on tenant and id and nothing else — so RLS reached
   * through that transaction is the entire guard, and this asserts it rather
   * than trusting the shape.
   *
   * The negative matters more than the positive: naming another tenant's
   * invoice id must yield NULL rather than its number, and null is also what
   * "no such invoice" gives — so a template cannot be used to discover whether
   * a record exists.
   */
  it("template placeholder values cannot reach another tenant's invoice", async () => {
    const invoiceType = accountingMailExtension.entityTypes.find(
      (t) => t.type === "invoice",
    )!;
    const ids: Record<string, string> = {};

    for (const [tenant, tag] of [
      [tenantA, "a"],
      [tenantB, "b"],
    ] as const) {
      ids[tag] = await withTenant(
        tenant,
        async (tx) => {
          const partyId = await seedParty(tx, tenant, `Placeholder Co ${tag}`);
          await tx.insert(schema.partyContactPoints).values({
            tenantId: tenant,
            partyId,
            kind: "email",
            value: `placeholder@${tag}.example`,
            normalizedValue: `placeholder@${tag}.example`,
            isPrimary: true,
          });
          const [customer] = await tx
            .insert(schema.customers)
            .values({
              tenantId: tenant,
              partyId,
              name: `Placeholder Co ${tag}`,
            })
            .returning();
          const [invoice] = await tx
            .insert(schema.invoices)
            .values({
              tenantId: tenant,
              customerId: customer.id,
              invoiceNumber: `PH-${tag.toUpperCase()}-1`,
              status: "issued",
              issueDate: "2026-08-01",
              dueDate: "2026-08-31",
              totalCents: 10_000,
              createdByClerkUserId: `user-${tag}`,
            })
            .returning();
          return invoice.id;
        },
        { role: "owner", userId: `user-${tag}` },
      );
    }

    // Its own tenant reads it, formatted by the extension rather than by Mail.
    const mine = await withTenant(
      tenantA,
      (tx) =>
        invoiceType.templateValues!(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          ids.a,
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(mine?.number).toBe("PH-A-1");
    expect(mine?.customer_name).toBe("Placeholder Co a");

    // THE ONE THAT MATTERS: tenant A naming tenant B's invoice gets nothing.
    const theirs = await withTenant(
      tenantA,
      (tx) =>
        invoiceType.templateValues!(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          ids.b,
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(theirs).toBe(null);

    // …and an invented id is indistinguishable from it, so the null cannot be
    // read as "that record exists but is not yours".
    const invented = await withTenant(
      tenantA,
      (tx) =>
        invoiceType.templateValues!(
          tx,
          { tenantId: tenantA, userId: "user-a", role: "owner" },
          "00000000-0000-4000-8000-000000000000",
        ),
      { role: "owner", userId: "user-a" },
    );
    expect(invented).toBe(null);
  });

  /**
   * mail_scheduled_sends — the fifth per-user table.
   *
   * The WITH CHECK matters more here than on any table before it. A forged row
   * would make the CRON SWEEP submit a draft on somebody else's behalf, from
   * their address — the sweep runs under `withSystem`, so RLS is not standing
   * behind it and the only thing stopping a member queueing mail as a colleague
   * is this policy refusing the insert.
   */
  it("a queued send is invisible to a colleague and refuses a forged owner", async () => {
    const queued = await withTenant(
      tenantA,
      (tx) =>
        tx
          .insert(schema.mailScheduledSends)
          .values({
            tenantId: tenantA,
            clerkUserId: "user-a",
            mailAccountId: fx.a.accountId,
            emailId: "draft-iso-a",
            identityId: "identity-a",
            fromEmail: "a@example.com",
            draftsMailboxId: "drafts-a",
            sentMailboxId: "sent-a",
            envelopeRcptTo: ["them@example.com"],
            sendAt: new Date(Date.now() + 3_600_000),
          })
          .returning({ id: schema.mailScheduledSends.id }),
      { userId: "user-a" },
    );
    expect(queued).toHaveLength(1);

    // Yours.
    const mine = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailScheduledSends),
      { userId: "user-a" },
    );
    expect(mine.map((r) => r.emailId)).toContain("draft-iso-a");

    // Not a colleague's, and not a caller who forgot to say who they are.
    const theirs = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailScheduledSends),
      { userId: COLLEAGUE },
    );
    expect(theirs).toHaveLength(0);
    const anonymous = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailScheduledSends),
    );
    expect(anonymous).toHaveLength(0);

    // THE ONE THAT MATTERS: a member cannot queue mail attributed to somebody
    // else, because the sweep would then send it as them.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.mailScheduledSends).values({
            tenantId: tenantA,
            clerkUserId: "user-a",
            mailAccountId: fx.a.accountId,
            emailId: "draft-iso-forged",
            identityId: "identity-a",
            fromEmail: "a@example.com",
            draftsMailboxId: "drafts-a",
            envelopeRcptTo: ["them@example.com"],
            sendAt: new Date(Date.now() + 3_600_000),
          }),
        { userId: COLLEAGUE },
      ),
    ).rejects.toThrow();
  });

  it("a queued send cannot point at another tenant's mail account", async () => {
    // The composite FK is what makes this structural rather than a check
    // somebody has to remember, exactly as it is for mail_links and snoozes.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.mailScheduledSends).values({
            tenantId: tenantA,
            clerkUserId: "user-a",
            mailAccountId: fx.b.accountId,
            emailId: "draft-iso-cross",
            identityId: "identity-a",
            fromEmail: "a@example.com",
            draftsMailboxId: "drafts-a",
            envelopeRcptTo: ["them@example.com"],
            sendAt: new Date(Date.now() + 3_600_000),
          }),
        { userId: "user-a" },
      ),
    ).rejects.toThrow();
  });

  it("a colleague cannot delete another user's connection, but you can delete your own", async () => {
    const deletedTheirs = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.mailAccounts)
          .where(eq(schema.mailAccounts.clerkUserId, "user-a"))
          .returning(),
      { userId: COLLEAGUE },
    );
    expect(deletedTheirs).toHaveLength(0);

    const deletedOwn = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.mailAccounts)
          .where(eq(schema.mailAccounts.clerkUserId, COLLEAGUE))
          .returning(),
      { userId: COLLEAGUE },
    );
    expect(deletedOwn).toHaveLength(1);
  });

  it("a colleague cannot see, or delete, another user's saved searches", async () => {
    // mail_saved_searches (0048) is the SECOND per-user table. The name of a
    // saved search is correspondence — "unread from the solicitor" tells a
    // colleague what somebody is dealing with — so it gets the same scoping
    // mail_accounts and mail_thread_index got in 0043.
    const [mine] = await withTenant(
      tenantA,
      (tx) =>
        tx
          .insert(schema.mailSavedSearches)
          .values({
            tenantId: tenantA,
            clerkUserId: "user-a",
            mailAccountId: fx.a.accountId,
            name: "Unread from the solicitor",
            nameKey: "unread from the solicitor",
            query: { unread: true },
          })
          .returning(),
      { userId: "user-a" },
    );
    expect(mine.id).toBeTruthy();

    // Member-writable, unlike the other per-user mail tables: the worst a
    // member can do to their own saved searches is save a bad one.
    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailSavedSearches),
      { userId: "user-a" },
    );
    expect(asOwner.some((r) => r.id === mine.id)).toBe(true);

    // Deliberately no where clause — the forgotten-predicate scenario.
    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailSavedSearches),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(0);

    const asNobody = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailSavedSearches),
    );
    expect(asNobody).toHaveLength(0);

    const deletedByColleague = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.mailSavedSearches)
          .where(eq(schema.mailSavedSearches.id, mine.id))
          .returning(),
      { userId: COLLEAGUE },
    );
    expect(deletedByColleague).toHaveLength(0);
  });

  it("cannot create a saved search attributed to a colleague", async () => {
    // The WITH CHECK pins clerk_user_id as well as tenant_id, so a member
    // cannot plant a view in somebody else's rail any more than they can read
    // one out of it.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.mailSavedSearches).values({
            tenantId: tenantA,
            clerkUserId: COLLEAGUE,
            mailAccountId: fx.a.accountId,
            name: "planted",
            nameKey: "planted",
            query: {},
          }),
        { userId: "user-a" },
      ),
    ).rejects.toThrow();
  });

  it("composite FK: a saved search cannot point at the OTHER tenant's connection", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailSavedSearches).values({
          tenantId: tenantA,
          clerkUserId: "user-a",
          mailAccountId: fx.b.accountId,
          name: "smuggled",
          nameKey: "smuggled",
          query: {},
        }),
      ),
    ).rejects.toThrow();
  });

  it("a colleague cannot see, or delete, another user's snoozes", async () => {
    // mail_snoozes (0050) is the THIRD per-user table. A row here is a diary
    // entry: it says what somebody is putting off and until when, message by
    // message. Same scoping as 0043 and 0048, for the same two reasons — the
    // mailbox ids are not shareable, and the list is nobody else's business.
    const [mine] = await withTenant(
      tenantA,
      (tx) =>
        tx
          .insert(schema.mailSnoozes)
          .values({
            tenantId: tenantA,
            clerkUserId: "user-a",
            mailAccountId: fx.a.accountId,
            emailId: "M-snooze-1",
            returnToMailboxId: "mbx-inbox",
            snoozeMailboxId: "mbx-snoozed",
            dueAt: new Date(Date.now() + 3_600_000),
          })
          .returning(),
      { userId: "user-a" },
    );
    expect(mine.id).toBeTruthy();

    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailSnoozes),
      { userId: "user-a" },
    );
    expect(asOwner.some((r) => r.id === mine.id)).toBe(true);

    // Deliberately no where clause — the forgotten-predicate scenario.
    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailSnoozes),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(0);

    const asNobody = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailSnoozes),
    );
    expect(asNobody).toHaveLength(0);

    const deletedByColleague = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.mailSnoozes)
          .where(eq(schema.mailSnoozes.id, mine.id))
          .returning(),
      { userId: COLLEAGUE },
    );
    expect(deletedByColleague).toHaveLength(0);
  });

  it("cannot snooze on a colleague's behalf", async () => {
    // The WITH CHECK pins clerk_user_id as well as tenant_id. Planting a snooze
    // in somebody else's account would move THEIR mail out of THEIR inbox,
    // which is a good deal worse than planting a saved search.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.mailSnoozes).values({
            tenantId: tenantA,
            clerkUserId: COLLEAGUE,
            mailAccountId: fx.a.accountId,
            emailId: "M-planted",
            returnToMailboxId: "mbx-inbox",
            snoozeMailboxId: "mbx-snoozed",
            dueAt: new Date(Date.now() + 3_600_000),
          }),
        { userId: "user-a" },
      ),
    ).rejects.toThrow();
  });

  it("a colleague cannot see, or write, another user's rules", async () => {
    // mail_rules (0051/0052) is the FOURTH per-user table. Reading somebody
    // else's rules is a privacy problem; WRITING one is worse than anything
    // the other three allow — a planted rule files a colleague's mail
    // somewhere they never look, server-side and invisible from the inbox.
    const [mine] = await withTenant(
      tenantA,
      (tx) =>
        tx
          .insert(schema.mailRules)
          .values({
            tenantId: tenantA,
            clerkUserId: "user-a",
            mailAccountId: fx.a.accountId,
            name: "Anything from the solicitor",
            matchMode: "all",
            tests: [{ field: "from", contains: "solicitor.example" }],
            action: { fileIntoMailboxId: "mbx1", fileIntoName: "Legal", markRead: false, flag: true },
          })
          .returning(),
      { userId: "user-a" },
    );
    expect(mine.id).toBeTruthy();

    const asOwner = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailRules),
      { userId: "user-a" },
    );
    expect(asOwner.some((r) => r.id === mine.id)).toBe(true);

    // Deliberately no where clause — the forgotten-predicate scenario.
    const asColleague = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.mailRules),
      { userId: COLLEAGUE },
    );
    expect(asColleague).toHaveLength(0);

    const asNobody = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.mailRules),
    );
    expect(asNobody).toHaveLength(0);

    const deleted = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.mailRules)
          .where(eq(schema.mailRules.id, mine.id))
          .returning(),
      { userId: COLLEAGUE },
    );
    expect(deleted).toHaveLength(0);
  });

  it("cannot plant a rule in a colleague's script", async () => {
    // The one that matters most on this table: a rule attributed to somebody
    // else would be compiled into THEIR Sieve script and run on THEIR mail.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.mailRules).values({
            tenantId: tenantA,
            clerkUserId: COLLEAGUE,
            mailAccountId: fx.a.accountId,
            name: "planted",
            matchMode: "all",
            tests: [{ field: "from", contains: "x" }],
            action: { fileIntoMailboxId: "mbx1", fileIntoName: "X", markRead: false, flag: false },
          }),
        { userId: "user-a" },
      ),
    ).rejects.toThrow();
  });

  it("composite FK: a snooze cannot point at the OTHER tenant's connection", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailSnoozes).values({
          tenantId: tenantA,
          clerkUserId: "user-a",
          mailAccountId: fx.b.accountId,
          emailId: "M-smuggled",
          returnToMailboxId: "mbx-inbox",
          snoozeMailboxId: "mbx-snoozed",
          dueAt: new Date(Date.now() + 3_600_000),
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot read the other tenant's mail password hashes", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.mailDirectoryAccounts)
        .where(eq(schema.mailDirectoryAccounts.id, fx.b.directoryId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("cannot read the other tenant's thread subjects", async () => {
    // Passes a valid user id on purpose, so this proves CROSS-TENANT denial
    // rather than passing trivially because no user was set.
    const rows = await withTenant(
      tenantA,
      (tx) =>
        tx
          .select()
          .from(schema.mailThreadIndex)
          .where(eq(schema.mailThreadIndex.threadId, "thread-b")),
      { userId: "user-a" },
    );
    expect(rows).toHaveLength(0);
  });

  it("members cannot write the trusted-code-only mail tables, even for their own tenant", async () => {
    // No member INSERT policy exists on any of these. A member who could write
    // mail_accounts could point an account at a token they control; one who
    // could write mail_directory_accounts could set a hash on a colleague's
    // address. Both are authentication bypasses, not data errors.
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.mailAccounts).values({
          tenantId: tenantA,
          mailboxId: fx.a.mailboxId,
          clerkUserId: "attacker",
          accessTokenEnc: "attacker-controlled",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.mailDirectoryAccounts).values({
          tenantId: tenantA,
          mailboxId: fx.a.mailboxId,
          login: `attacker-${STAMP_MAIL}@example.test`,
          passwordHash: "$argon2id$chosen-by-attacker",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.mailboxes).values({
          tenantId: tenantA,
          mailboxDomainId: fx.a.domainId,
          localPart: "attacker",
          address: `attacker@a-${STAMP_MAIL}.example`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("members CAN write links and annotations for their own tenant", async () => {
    // The deliberate exception: attaching a thread to an invoice is ordinary
    // daily work, not an administrative act.
    const inserted = await withTenant(tenantA, (tx) =>
      tx
        .insert(schema.mailLinks)
        .values({
          tenantId: tenantA,
          mailAccountId: fx.a.accountId,
          threadId: "thread-a",
          extensionSlug: "accounting",
          entityType: "invoice",
          entityId: fx.a.mailboxId,
          createdByClerkUserId: "user-a",
        })
        .returning(),
    );
    expect(inserted).toHaveLength(1);

    // The annotation counter (0045). Member-writable for the same reason the
    // row is: a layer reprocessing a thread is ordinary work.
    const bumped = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.mailAnnotations)
        .set({ data: { note: "reprocessed" }, version: 2 })
        .where(eq(schema.mailAnnotations.tenantId, tenantA))
        .returning(),
    );
    expect(bumped.length).toBeGreaterThan(0);
    expect(bumped[0].version).toBe(2);
  });

  it("cannot INSERT links or annotations attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.mailLinks).values({
          tenantId: tenantB,
          mailAccountId: fx.b.accountId,
          threadId: "thread-b",
          extensionSlug: "accounting",
          entityType: "invoice",
          entityId: fx.b.mailboxId,
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.mailAnnotations).values({
          tenantId: tenantB,
          threadId: "thread-b",
          extensionSlug: "accounting",
          data: { planted: true },
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's mailbox cannot hang off the OTHER tenant's domain", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailboxes).values({
          tenantId: tenantA,
          mailboxDomainId: fx.b.domainId,
          localPart: "smuggled",
          address: `smuggled@b-${STAMP_MAIL}.example`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's connection cannot point at the OTHER tenant's mailbox", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailAccounts).values({
          tenantId: tenantA,
          mailboxId: fx.b.mailboxId,
          clerkUserId: "user-a",
          accessTokenEnc: "x",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's thread index cannot point at the OTHER tenant's connection", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailThreadIndex).values({
          tenantId: tenantA,
          mailAccountId: fx.b.accountId,
          threadId: "smuggled",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's link cannot point at the OTHER tenant's connection", async () => {
    // `mail_links` is MEMBER-writable, which makes this the one composite FK in
    // the module that an ordinary user could try to bend. RLS pins tenant_id, so
    // the smuggled account id is the only field left to aim — and 0046's
    // composite FK is what refuses it. Attempted as a member, not under
    // withSystem, because that is who would actually be doing it.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.mailLinks).values({
            tenantId: tenantA,
            mailAccountId: fx.b.accountId,
            threadId: "smuggled",
            extensionSlug: "accounting",
            entityType: "invoice",
            entityId: fx.a.mailboxId,
            createdByClerkUserId: "attacker",
          }),
        { role: "owner", userId: "user-a" },
      ),
    ).rejects.toThrow();
  });

  it("disconnecting a mailbox KEEPS its links and nulls only the account id", async () => {
    // The single most important behaviour 0046 buys, and the reason the FK is
    // ON DELETE SET NULL (mail_account_id) rather than CASCADE.
    //
    // Linking copies the message into Documents precisely so the link survives
    // the person who made it — their token expiring, their disconnecting the
    // mailbox, their leaving the business — which is exactly when the
    // correspondence behind an invoice is most wanted. CASCADE would delete it
    // at that moment and quietly undo the whole design.
    //
    // The column list is load-bearing too: a plain SET NULL on a composite FK
    // nulls EVERY key column, including tenant_id, which is NOT NULL — so the
    // disconnect would fail outright. This asserts tenant_id survives.
    const doomed = await withSystem(async (tx) => {
      const [account] = await tx
        .insert(schema.mailAccounts)
        .values({
          tenantId: tenantA,
          mailboxId: fx.a.mailboxId,
          clerkUserId: "user-a-leaver",
          accessTokenEnc: "ciphertext-token-of-leaver",
        })
        .returning();
      const [link] = await tx
        .insert(schema.mailLinks)
        .values({
          tenantId: tenantA,
          mailAccountId: account.id,
          threadId: "thread-of-the-leaver",
          extensionSlug: "accounting",
          entityType: "invoice",
          entityId: fx.a.mailboxId,
          createdByClerkUserId: "user-a-leaver",
        })
        .returning();
      return { accountId: account.id, linkId: link.id };
    });

    // Deleted the way the app does it: by the person themselves, under the
    // member DELETE policy from 0043.
    const removed = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.mailAccounts)
          .where(eq(schema.mailAccounts.id, doomed.accountId))
          .returning(),
      { userId: "user-a-leaver" },
    );
    expect(removed).toHaveLength(1);

    const survivors = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.mailLinks)
        .where(eq(schema.mailLinks.id, doomed.linkId)),
    );
    expect(survivors).toHaveLength(1);
    expect(survivors[0].mailAccountId).toBeNull();
    expect(survivors[0].tenantId).toBe(tenantA);
    // The route back to the live thread is what was genuinely lost; the thread
    // id itself is kept, so the row still records which conversation it was.
    expect(survivors[0].threadId).toBe("thread-of-the-leaver");
  });

  it("composite FK: A's directory row cannot point at the OTHER tenant's mailbox", async () => {
    // This one is the authentication boundary: a directory row is what the mail
    // server authenticates against, so a cross-tenant one is a working login
    // for an address that belongs to somebody else.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.mailDirectoryAccounts).values({
          tenantId: tenantA,
          mailboxId: fx.b.mailboxId,
          login: `smuggled-${STAMP_MAIL}@example.test`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cross-tenant UPDATE and DELETE affect zero mail rows", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.mailAnnotations)
        .set({ data: { defaced: true } })
        .where(eq(schema.mailAnnotations.tenantId, tenantB))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.mailLinks)
        .where(eq(schema.mailLinks.tenantId, tenantB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("default-deny: no context sees no mail rows at all", async () => {
    const results = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_role', '', true)`);
      return Promise.all([
        tx.select().from(schema.mailboxDomains),
        tx.select().from(schema.mailboxes),
        tx.select().from(schema.mailDirectoryAccounts),
        tx.select().from(schema.mailAccounts),
        tx.select().from(schema.mailThreadIndex),
        tx.select().from(schema.mailLinks),
        tx.select().from(schema.mailAnnotations),
        tx.select().from(schema.mailSavedSearches),
      ]);
    });
    for (const rows of results) expect(rows).toHaveLength(0);
  });
});
