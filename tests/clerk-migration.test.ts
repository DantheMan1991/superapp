import { describe, expect, it } from "vitest";
import {
  buildCreateOrganizationBody,
  buildCreateUserBody,
  classifyColumn,
  findPassword,
  keyKind,
  membershipFromApi,
  parseCsv,
  parsePasswordCsv,
  planColumn,
  primaryEmail,
  reverseMapping,
  summarizePlan,
  userFromApi,
  validateMapping,
  type Mapping,
  type SnapshotUser,
} from "../scripts/lib/clerk-migration";

/**
 * The pure half of the Clerk instance migration. Every decision the three
 * scripts make that does not need a network or a database is here, because
 * the scripts run once, against production, with no second try that costs
 * nothing.
 */

const apiUser = {
  id: "user_old1",
  primary_email_address_id: "idn_2",
  email_addresses: [
    { id: "idn_1", email_address: "second@example.com", verification: { status: "verified" } },
    { id: "idn_2", email_address: "Dan@example.com", verification: { status: "verified" } },
    { id: "idn_3", email_address: "unverified@example.com", verification: null },
  ],
  first_name: "Dan",
  last_name: null,
  username: null,
  image_url: "https://img.example/1.png",
  external_id: null,
  public_metadata: { role: "superadmin" },
  private_metadata: {},
  unsafe_metadata: {},
  password_enabled: true,
  totp_enabled: false,
  external_accounts: [{ provider: "oauth_github" }],
  created_at: 1_700_000_000_000,
  last_sign_in_at: null,
};

function user(overrides: Partial<SnapshotUser> = {}): SnapshotUser {
  return { ...userFromApi(apiUser), ...overrides };
}

const mapping: Mapping = {
  createdAt: "2026-09-05T00:00:00.000Z",
  source: "test",
  target: "live",
  users: { user_old1: "user_new1", user_old2: "user_new2" },
  organizations: { org_old1: "org_new1" },
};

describe("keyKind", () => {
  it("tells the two instance kinds apart and admits ignorance", () => {
    expect(keyKind("sk_test_abc")).toBe("test");
    expect(keyKind("sk_live_abc")).toBe("live");
    expect(keyKind("pk_live_abc")).toBe("unknown");
    expect(keyKind(undefined)).toBe("unknown");
    expect(keyKind("")).toBe("unknown");
  });
});

describe("userFromApi", () => {
  it("puts the primary address first and keeps verification", () => {
    const u = userFromApi(apiUser);
    expect(u.emails.map((e) => e.address)).toEqual([
      "Dan@example.com",
      "second@example.com",
      "unverified@example.com",
    ]);
    expect(u.emails[0]).toEqual({ address: "Dan@example.com", primary: true, verified: true });
    expect(u.emails[2].verified).toBe(false);
    expect(primaryEmail(u)).toBe("Dan@example.com");
  });

  it("carries what the import needs and nothing it cannot use", () => {
    const u = userFromApi(apiUser);
    expect(u.id).toBe("user_old1");
    expect(u.firstName).toBe("Dan");
    expect(u.lastName).toBeNull();
    expect(u.publicMetadata).toEqual({ role: "superadmin" });
    expect(u.passwordEnabled).toBe(true);
    expect(u.externalAccounts).toEqual(["oauth_github"]);
    expect(u.createdAt).toBe(1_700_000_000_000);
  });

  it("falls back to the first address when none is marked primary", () => {
    const u = userFromApi({ ...apiUser, primary_email_address_id: null });
    expect(u.emails.every((e) => !e.primary)).toBe(true);
    expect(primaryEmail(u)).toBe("second@example.com");
  });
});

describe("membershipFromApi", () => {
  it("needs a user id and defaults the role", () => {
    expect(membershipFromApi("org_1", { public_user_data: {} })).toBeNull();
    expect(
      membershipFromApi("org_1", { role: "org:admin", public_user_data: { user_id: "user_1" } }),
    ).toEqual({ organizationId: "org_1", userId: "user_1", role: "org:admin" });
    expect(membershipFromApi("org_1", { public_user_data: { user_id: "user_1" } })?.role).toBe(
      "org:member",
    );
  });
});

describe("parseCsv", () => {
  it("handles quoted commas, doubled quotes, CRLF and a trailing newline", () => {
    const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,,\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["2", "", ""],
    ]);
  });
});

describe("parsePasswordCsv", () => {
  const header = "id,first_name,primary_email_address,password_digest,password_hasher";

  it("is header-driven and drops people without a digest", () => {
    const { rows, missing } = parsePasswordCsv(
      `${header}\nuser_1,Dan,Dan@Example.com,$2a$10$abc,bcrypt\nuser_2,Kim,kim@example.com,,\n`,
    );
    expect(missing).toEqual([]);
    expect(rows).toEqual([
      { id: "user_1", email: "dan@example.com", digest: "$2a$10$abc", hasher: "bcrypt" },
    ]);
  });

  it("survives a reordered header and defaults the hasher", () => {
    const { rows } = parsePasswordCsv(
      "password_hasher,password_digest,id\n,$2a$10$abc,user_1\n",
    );
    expect(rows).toEqual([{ id: "user_1", email: null, digest: "$2a$10$abc", hasher: "bcrypt" }]);
  });

  it("names the columns it cannot find", () => {
    const parsed = parsePasswordCsv("id,email\nuser_1,dan@example.com\n");
    expect(parsed.missing).toEqual(["password_digest", "password_hasher"]);
    expect(parsed.rows).toEqual([]);
    expect(parsed.columns).toEqual(["id", "email"]);
  });
});

describe("findPassword", () => {
  const rows = [
    { id: "user_other", email: "dan@example.com", digest: "by-email-wrong-id", hasher: "bcrypt" },
    { id: "user_old1", email: "someone@else.com", digest: "by-id", hasher: "bcrypt" },
  ];

  it("prefers the Clerk id over the address", () => {
    expect(findPassword(rows, user())?.digest).toBe("by-id");
  });

  it("falls back to the primary address, case-insensitively", () => {
    const idless = rows.map((r) => ({ ...r, id: null }));
    expect(findPassword(idless, user())?.digest).toBe("by-email-wrong-id");
    expect(findPassword(idless, user({ emails: [] }))).toBeUndefined();
  });
});

describe("buildCreateUserBody", () => {
  it("keeps the old id, the address order and the hash when there is one", () => {
    const body = buildCreateUserBody(user(), {
      id: "user_old1",
      email: null,
      digest: "$2a$10$abc",
      hasher: "bcrypt",
    });
    expect(body).toMatchObject({
      external_id: "user_old1",
      email_address: ["Dan@example.com", "second@example.com", "unverified@example.com"],
      first_name: "Dan",
      public_metadata: { role: "superadmin" },
      password_digest: "$2a$10$abc",
      password_hasher: "bcrypt",
      skip_legal_checks: true,
      created_at: "2023-11-14T22:13:20.000Z",
    });
    expect(body).not.toHaveProperty("skip_password_requirement");
    expect(body).not.toHaveProperty("last_name");
    expect(body).not.toHaveProperty("private_metadata");
  });

  it("skips the password requirement when there is no hash to carry", () => {
    const body = buildCreateUserBody(user({ createdAt: null }));
    expect(body.skip_password_requirement).toBe(true);
    expect(body).not.toHaveProperty("password_digest");
    expect(body).not.toHaveProperty("created_at");
  });
});

describe("buildCreateOrganizationBody", () => {
  const org = {
    id: "org_old1",
    name: "Hilltop Farm",
    slug: "hilltop-farm",
    imageUrl: null,
    createdBy: "user_old1",
    publicMetadata: { plan: "farm" },
    privateMetadata: {},
    createdAt: null,
    membersCount: 1,
  };

  it("remembers where it came from and who made it", () => {
    expect(buildCreateOrganizationBody(org, "user_new1")).toEqual({
      name: "Hilltop Farm",
      slug: "hilltop-farm",
      created_by: "user_new1",
      public_metadata: { plan: "farm", migrated_from_org_id: "org_old1" },
    });
  });

  it("leaves created_by out when nobody is mapped yet", () => {
    expect(buildCreateOrganizationBody({ ...org, slug: null }, null)).not.toHaveProperty(
      "created_by",
    );
    expect(buildCreateOrganizationBody({ ...org, slug: null }, null)).not.toHaveProperty("slug");
  });
});

describe("validateMapping", () => {
  it("accepts a sound mapping and reverses it", () => {
    expect(validateMapping(mapping)).toEqual(mapping);
    const back = reverseMapping(mapping);
    expect(back.users).toEqual({ user_new1: "user_old1", user_new2: "user_old2" });
    expect(back.organizations).toEqual({ org_new1: "org_old1" });
    expect(back.source).toBe("live");
    expect(back.target).toBe("test");
  });

  it("refuses an id mapped to itself", () => {
    expect(() =>
      validateMapping({ ...mapping, users: { user_1: "user_1" } }),
    ).toThrow(/maps to itself/);
  });

  it("refuses two old ids that would merge into one", () => {
    expect(() =>
      validateMapping({ ...mapping, organizations: { org_a: "org_x", org_b: "org_x" } }),
    ).toThrow(/both map to "org_x"/);
  });

  it("refuses shapes that are not a table of strings", () => {
    expect(() => validateMapping({ ...mapping, users: ["user_1"] })).toThrow(/must be an object/);
    expect(() => validateMapping({ ...mapping, users: { user_1: "" } })).toThrow(/non-empty/);
  });
});

describe("classifyColumn", () => {
  it("sorts columns into the two id families and ignores the rest", () => {
    expect(classifyColumn("profiles", "clerk_user_id")).toEqual({
      table: "profiles",
      column: "clerk_user_id",
      family: "users",
    });
    expect(classifyColumn("work_items", "assignee_clerk_user_id")?.family).toBe("users");
    expect(classifyColumn("tenants", "clerk_org_id")?.family).toBe("organizations");
    expect(classifyColumn("memberships", "clerk_role_synced_at")).toBeNull();
  });
});

describe("planColumn", () => {
  const column = { table: "work_items", column: "created_by_clerk_user_id", family: "users" as const };

  it("separates rewrites, already-new values, strangers and the empty string", () => {
    const plan = planColumn(column, ["user_old1", "", "user_new2", "user_gone"], mapping);
    expect(plan.changes).toEqual([{ from: "user_old1", to: "user_new1" }]);
    expect(plan.alreadyNew).toEqual(["user_new2"]);
    expect(plan.unmapped).toEqual(["user_gone"]);
  });

  it("uses the organization table for organization columns", () => {
    const plan = planColumn(
      { table: "tenants", column: "clerk_org_id", family: "organizations" },
      ["org_old1", "user_old1"],
      mapping,
    );
    expect(plan.changes).toEqual([{ from: "org_old1", to: "org_new1" }]);
    expect(plan.unmapped).toEqual(["user_old1"]);
  });

  it("summarises across columns", () => {
    const plans = [
      planColumn(column, ["user_old1", "user_old2"], mapping),
      planColumn({ ...column, table: "documents" }, ["user_gone"], mapping),
      planColumn({ ...column, table: "invoices" }, [], mapping),
    ];
    expect(summarizePlan(plans)).toEqual({
      columns: 3,
      columnsTouched: 1,
      changes: 2,
      unmapped: 1,
      alreadyNew: 0,
    });
  });
});
