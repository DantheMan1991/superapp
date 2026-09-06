/**
 * Pure helpers for moving the platform from one Clerk instance to another —
 * what `scripts/clerk-export.ts`, `scripts/clerk-import.ts` and
 * `scripts/clerk-remap.ts` share, kept free of network and database so
 * `tests/clerk-migration.test.ts` can exercise every decision in them.
 *
 * Why this exists at all: a Clerk production instance starts EMPTY. Users,
 * organizations and memberships do not move with the keys, and every id
 * changes. This platform mirrors those ids — `profiles.clerk_user_id`,
 * `tenants.clerk_org_id`, and a `*_clerk_user_id` column on most tables that
 * records who did something — so "switch the keys" is really "recreate the
 * people and rewrite the mirror". The runbook is
 * docs/runbooks/clerk-production-cutover.md.
 */

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export type KeyKind = "test" | "live" | "unknown";

/** `sk_test_` is a development instance; `sk_live_` a production one. */
export function keyKind(secretKey: string | undefined): KeyKind {
  if (!secretKey) return "unknown";
  if (secretKey.startsWith("sk_test_")) return "test";
  if (secretKey.startsWith("sk_live_")) return "live";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Snapshot — what the export writes and the import reads
// ---------------------------------------------------------------------------

export interface SnapshotEmail {
  address: string;
  primary: boolean;
  verified: boolean;
}

export interface SnapshotUser {
  id: string;
  emails: SnapshotEmail[];
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  imageUrl: string | null;
  externalId: string | null;
  publicMetadata: Record<string, unknown>;
  privateMetadata: Record<string, unknown>;
  unsafeMetadata: Record<string, unknown>;
  passwordEnabled: boolean;
  totpEnabled: boolean;
  /** Provider keys, e.g. `oauth_google`. Links cannot be moved — see the runbook. */
  externalAccounts: string[];
  /** Epoch milliseconds, as Clerk reports them. */
  createdAt: number | null;
  lastSignInAt: number | null;
}

export interface SnapshotOrganization {
  id: string;
  name: string;
  slug: string | null;
  imageUrl: string | null;
  createdBy: string | null;
  publicMetadata: Record<string, unknown>;
  privateMetadata: Record<string, unknown>;
  createdAt: number | null;
  membersCount: number | null;
}

export interface SnapshotMembership {
  organizationId: string;
  userId: string;
  /** Clerk role key: `org:admin` or `org:member` on this platform. */
  role: string;
}

export interface SnapshotInvitation {
  organizationId: string;
  emailAddress: string;
  role: string;
  status: string;
}

export interface Snapshot {
  exportedAt: string;
  source: { keyKind: KeyKind };
  users: SnapshotUser[];
  organizations: SnapshotOrganization[];
  memberships: SnapshotMembership[];
  invitations: SnapshotInvitation[];
}

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function epoch(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Backend API `User` → snapshot. Primary address first, so the import creates it first. */
export function userFromApi(raw: Json): SnapshotUser {
  const addresses = Array.isArray(raw.email_addresses) ? raw.email_addresses : [];
  const primaryId = text(raw.primary_email_address_id);
  const emails: SnapshotEmail[] = addresses
    .map((entry) => record(entry))
    .filter((entry) => typeof entry.email_address === "string")
    .map((entry) => ({
      address: entry.email_address as string,
      primary: primaryId !== null && entry.id === primaryId,
      verified: record(entry.verification).status === "verified",
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
  const external = Array.isArray(raw.external_accounts) ? raw.external_accounts : [];
  return {
    id: String(raw.id),
    emails,
    firstName: text(raw.first_name),
    lastName: text(raw.last_name),
    username: text(raw.username),
    imageUrl: text(raw.image_url),
    externalId: text(raw.external_id),
    publicMetadata: record(raw.public_metadata),
    privateMetadata: record(raw.private_metadata),
    unsafeMetadata: record(raw.unsafe_metadata),
    passwordEnabled: raw.password_enabled === true,
    totpEnabled: raw.totp_enabled === true,
    externalAccounts: external
      .map((entry) => text(record(entry).provider))
      .filter((provider): provider is string => provider !== null),
    createdAt: epoch(raw.created_at),
    lastSignInAt: epoch(raw.last_sign_in_at),
  };
}

export function organizationFromApi(raw: Json): SnapshotOrganization {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    slug: text(raw.slug),
    imageUrl: text(raw.image_url),
    createdBy: text(raw.created_by),
    publicMetadata: record(raw.public_metadata),
    privateMetadata: record(raw.private_metadata),
    createdAt: epoch(raw.created_at),
    membersCount: epoch(raw.members_count),
  };
}

/** Null when the payload names no user — nothing to recreate. */
export function membershipFromApi(
  organizationId: string,
  raw: Json,
): SnapshotMembership | null {
  const userId = text(record(raw.public_user_data).user_id);
  if (!userId) return null;
  return { organizationId, userId, role: String(raw.role ?? "org:member") };
}

export function invitationFromApi(
  organizationId: string,
  raw: Json,
): SnapshotInvitation {
  return {
    organizationId,
    emailAddress: String(raw.email_address ?? ""),
    role: String(raw.role ?? "org:member"),
    status: String(raw.status ?? "pending"),
  };
}

export function primaryEmail(user: SnapshotUser): string | null {
  return (user.emails.find((e) => e.primary) ?? user.emails[0])?.address ?? null;
}

// ---------------------------------------------------------------------------
// Mapping — old id → new id, the artefact the remap runs on
// ---------------------------------------------------------------------------

export interface Mapping {
  createdAt: string;
  source: KeyKind;
  target: KeyKind;
  users: Record<string, string>;
  organizations: Record<string, string>;
}

function validateTable(name: string, table: unknown): Record<string, string> {
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    throw new Error(`mapping.${name} must be an object of old id → new id`);
  }
  const seen = new Map<string, string>();
  for (const [from, to] of Object.entries(table as Record<string, unknown>)) {
    if (typeof to !== "string" || to.length === 0) {
      throw new Error(`mapping.${name}["${from}"] must be a non-empty string`);
    }
    if (from === to) {
      throw new Error(`mapping.${name}["${from}"] maps to itself`);
    }
    const earlier = seen.get(to);
    if (earlier) {
      throw new Error(
        `mapping.${name}: "${earlier}" and "${from}" both map to "${to}"`,
      );
    }
    seen.set(to, from);
  }
  return table as Record<string, string>;
}

/**
 * Refuses a mapping that could corrupt the mirror: an id mapped to itself
 * would be a no-op that hides a missing entry, and two old ids mapped to one
 * new id would merge two people or two tenants.
 */
export function validateMapping(value: unknown): Mapping {
  const raw = record(value);
  return {
    createdAt: String(raw.createdAt ?? ""),
    source: (raw.source as KeyKind) ?? "unknown",
    target: (raw.target as KeyKind) ?? "unknown",
    users: validateTable("users", raw.users),
    organizations: validateTable("organizations", raw.organizations),
  };
}

/** The rollback: apply new → old. */
export function reverseMapping(mapping: Mapping): Mapping {
  const flip = (table: Record<string, string>) =>
    Object.fromEntries(Object.entries(table).map(([from, to]) => [to, from]));
  return {
    createdAt: mapping.createdAt,
    source: mapping.target,
    target: mapping.source,
    users: flip(mapping.users),
    organizations: flip(mapping.organizations),
  };
}

// ---------------------------------------------------------------------------
// Password export — the Clerk dashboard's "Export all users" CSV
// ---------------------------------------------------------------------------

export interface PasswordRow {
  id: string | null;
  email: string | null;
  digest: string;
  hasher: string;
}

/** RFC 4180: quoted fields, doubled quotes inside them, CRLF or LF rows. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.length > 0));
}

const ID_COLUMNS = ["id", "user_id"];
const EMAIL_COLUMNS = ["primary_email_address", "email_address", "email"];
const DIGEST_COLUMNS = ["password_digest"];
const HASHER_COLUMNS = ["password_hasher"];

function columnIndex(header: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const index = header.indexOf(candidate);
    if (index >= 0) return index;
  }
  return -1;
}

/**
 * Header-driven, so a column Clerk adds or reorders does not break it. Rows
 * without a digest are dropped: they are people who sign in some other way,
 * and the import handles them by `skip_password_requirement`.
 */
export function parsePasswordCsv(input: string): {
  columns: string[];
  rows: PasswordRow[];
  missing: string[];
} {
  const [header = [], ...body] = parseCsv(input);
  const columns = header.map((h) => h.trim().toLowerCase());
  const id = columnIndex(columns, ID_COLUMNS);
  const email = columnIndex(columns, EMAIL_COLUMNS);
  const digest = columnIndex(columns, DIGEST_COLUMNS);
  const hasher = columnIndex(columns, HASHER_COLUMNS);
  const missing: string[] = [];
  if (digest < 0) missing.push(DIGEST_COLUMNS[0]);
  if (hasher < 0) missing.push(HASHER_COLUMNS[0]);
  if (missing.length > 0) return { columns, rows: [], missing };
  const rows: PasswordRow[] = [];
  for (const cells of body) {
    const value = cells[digest]?.trim() ?? "";
    if (!value) continue;
    rows.push({
      id: id >= 0 ? text(cells[id]?.trim()) : null,
      email: email >= 0 ? text(cells[email]?.trim().toLowerCase()) : null,
      digest: value,
      hasher: cells[hasher]?.trim() || "bcrypt",
    });
  }
  return { columns, rows, missing };
}

/** By Clerk id first; by primary email, case-insensitively, when the CSV has no id. */
export function findPassword(
  rows: PasswordRow[],
  user: SnapshotUser,
): PasswordRow | undefined {
  const byId = rows.find((row) => row.id !== null && row.id === user.id);
  if (byId) return byId;
  const email = primaryEmail(user)?.toLowerCase();
  if (!email) return undefined;
  return rows.find((row) => row.email === email);
}

// ---------------------------------------------------------------------------
// Request bodies — the raw Backend API is snake_case
// ---------------------------------------------------------------------------

function nonEmpty(value: Json): Json | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

/**
 * `external_id` carries the OLD id, which makes the import idempotent (a
 * rerun finds the person by it instead of creating a twin) and lets the
 * mapping be rebuilt from the target instance alone if the file is lost.
 *
 * Addresses created through the Backend API are verified by default, which
 * is what lets a Google or Apple sign-in on the new instance link to the
 * recreated account by email instead of minting a second one.
 */
export function buildCreateUserBody(
  user: SnapshotUser,
  password?: PasswordRow,
): Json {
  const body: Json = {
    external_id: user.id,
    email_address: user.emails.map((e) => e.address),
    skip_legal_checks: true,
  };
  if (user.firstName) body.first_name = user.firstName;
  if (user.lastName) body.last_name = user.lastName;
  if (user.username) body.username = user.username;
  const publicMetadata = nonEmpty(user.publicMetadata);
  if (publicMetadata) body.public_metadata = publicMetadata;
  const privateMetadata = nonEmpty(user.privateMetadata);
  if (privateMetadata) body.private_metadata = privateMetadata;
  const unsafeMetadata = nonEmpty(user.unsafeMetadata);
  if (unsafeMetadata) body.unsafe_metadata = unsafeMetadata;
  if (user.createdAt !== null) {
    body.created_at = new Date(user.createdAt).toISOString();
  }
  if (password) {
    body.password_digest = password.digest;
    body.password_hasher = password.hasher;
  } else {
    // Sign in by email code or a social account, or set a password from
    // "forgot password" — the person is not locked out, they just have no
    // password on the new instance yet.
    body.skip_password_requirement = true;
  }
  return body;
}

/** The old id is kept on the organization too, in public metadata, for the same reasons. */
export function buildCreateOrganizationBody(
  org: SnapshotOrganization,
  createdBy: string | null,
): Json {
  const body: Json = {
    name: org.name,
    public_metadata: { ...org.publicMetadata, migrated_from_org_id: org.id },
  };
  if (org.slug) body.slug = org.slug;
  if (createdBy) body.created_by = createdBy;
  const privateMetadata = nonEmpty(org.privateMetadata);
  if (privateMetadata) body.private_metadata = privateMetadata;
  return body;
}

// ---------------------------------------------------------------------------
// Remap — every column of the mirror, discovered rather than listed
// ---------------------------------------------------------------------------

export type IdFamily = "users" | "organizations";

export interface ClerkIdColumn {
  table: string;
  column: string;
  family: IdFamily;
}

/**
 * Discovered from the catalogue at run time instead of maintained by hand:
 * a column added next month must be rewritten too, and a list in this file
 * would not know about it. Text columns only — the ids live in `text`
 * columns, and the one JSON that mentions them (`audit_log.meta`) is a
 * record of what happened at the time, left as written.
 */
export const CLERK_ID_COLUMNS_SQL = `
  select table_name, column_name
  from information_schema.columns
  where table_schema = 'public'
    and data_type in ('text', 'character varying')
    and (column_name like '%clerk_user_id%' or column_name like '%clerk_org_id%')
  order by table_name, column_name
`;

export function classifyColumn(
  table: string,
  column: string,
): ClerkIdColumn | null {
  if (column.includes("clerk_user_id")) return { table, column, family: "users" };
  if (column.includes("clerk_org_id")) {
    return { table, column, family: "organizations" };
  }
  return null;
}

export interface ColumnPlan {
  column: ClerkIdColumn;
  /** Distinct values this column holds that the mapping rewrites. */
  changes: Array<{ from: string; to: string }>;
  /** Distinct values that look like ids the mapping does not know. */
  unmapped: string[];
  /** Values the mapping already produced — a rerun, or a row written since. */
  alreadyNew: string[];
}

/**
 * One column's worth of decisions. Empty strings are the "nobody" a few
 * columns default to and are never an id.
 */
export function planColumn(
  column: ClerkIdColumn,
  distinctValues: string[],
  mapping: Mapping,
): ColumnPlan {
  const table = mapping[column.family];
  const targets = new Set(Object.values(table));
  const plan: ColumnPlan = { column, changes: [], unmapped: [], alreadyNew: [] };
  for (const value of distinctValues) {
    if (value === "") continue;
    const to = table[value];
    if (to) plan.changes.push({ from: value, to });
    else if (targets.has(value)) plan.alreadyNew.push(value);
    else plan.unmapped.push(value);
  }
  return plan;
}

export function summarizePlan(plans: ColumnPlan[]): {
  columns: number;
  columnsTouched: number;
  changes: number;
  unmapped: number;
  alreadyNew: number;
} {
  return {
    columns: plans.length,
    columnsTouched: plans.filter((p) => p.changes.length > 0).length,
    changes: plans.reduce((n, p) => n + p.changes.length, 0),
    unmapped: plans.reduce((n, p) => n + p.unmapped.length, 0),
    alreadyNew: plans.reduce((n, p) => n + p.alreadyNew.length, 0),
  };
}

/** `"table"."column"` — the catalogue returns unquoted names; quote them once, here. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
