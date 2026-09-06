import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ClerkApi } from "./lib/clerk-api";
import {
  invitationFromApi,
  keyKind,
  membershipFromApi,
  organizationFromApi,
  primaryEmail,
  userFromApi,
  type Snapshot,
  type SnapshotInvitation,
  type SnapshotMembership,
} from "./lib/clerk-migration";

/**
 * `npm run clerk:export` — write a snapshot of the SOURCE Clerk instance:
 * every user, organization, membership and pending invitation, in the shape
 * `scripts/clerk-import.ts` reads. Step 2 of
 * docs/runbooks/clerk-production-cutover.md.
 *
 *   npm run clerk:export                              → clerk-migration/snapshot.json
 *   npm run clerk:export -- --out somewhere/else.json
 *
 * Reads CLERK_SOURCE_SECRET_KEY, or CLERK_SECRET_KEY when that is unset —
 * which on a laptop is the development instance, the one being left behind.
 * A live key needs `--from-live`, so the direction of a migration is always
 * stated rather than assumed.
 *
 * No secret leaves Clerk here: password hashes are not readable through the
 * API. They come from the dashboard's "Export all users" CSV, which the
 * import takes separately (`--passwords`).
 */

type Json = Record<string, unknown>;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const key =
    process.env.CLERK_SOURCE_SECRET_KEY || process.env.CLERK_SECRET_KEY;
  const kind = keyKind(key);
  if (!key || kind === "unknown") {
    console.error(
      "Set CLERK_SOURCE_SECRET_KEY (or CLERK_SECRET_KEY) to the secret key of the instance to export.",
    );
    process.exit(1);
  }
  if (kind === "live" && !process.argv.includes("--from-live")) {
    console.error(
      "The source key is a LIVE key. The usual direction is development → production; pass --from-live to export a production instance.",
    );
    process.exit(1);
  }
  const out = arg("--out") ?? path.join("clerk-migration", "snapshot.json");
  const api = new ClerkApi(key);

  console.log(`Exporting the ${kind} instance…`);
  const users = (
    await api.list<Json>("/users", { order_by: "+created_at" })
  ).map(userFromApi);
  const organizations = (
    await api.list<Json>("/organizations", { include_members_count: "true" })
  ).map(organizationFromApi);
  const memberships: SnapshotMembership[] = [];
  const invitations: SnapshotInvitation[] = [];
  for (const org of organizations) {
    for (const raw of await api.list<Json>(
      `/organizations/${org.id}/memberships`,
    )) {
      const row = membershipFromApi(org.id, raw);
      if (row) memberships.push(row);
    }
    for (const raw of await api.list<Json>(
      `/organizations/${org.id}/invitations`,
      { status: "pending" },
    )) {
      invitations.push(invitationFromApi(org.id, raw));
    }
  }

  const snapshot: Snapshot = {
    exportedAt: new Date().toISOString(),
    source: { keyKind: kind },
    users,
    organizations,
    memberships,
    invitations,
  };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snapshot, null, 2));

  console.log(`\n${users.length} users`);
  for (const user of users) {
    console.log(
      `  ${user.id}  ${primaryEmail(user) ?? "(no email)"}  password=${user.passwordEnabled}  social=${user.externalAccounts.join(",") || "-"}`,
    );
  }
  console.log(`\n${organizations.length} organizations`);
  for (const org of organizations) {
    console.log(`  ${org.id}  ${org.name}  slug=${org.slug ?? "-"}`);
    for (const m of memberships.filter((x) => x.organizationId === org.id)) {
      console.log(`      ${m.userId}  ${m.role}`);
    }
    for (const i of invitations.filter((x) => x.organizationId === org.id)) {
      console.log(`      invitation pending: ${i.emailAddress} as ${i.role}`);
    }
  }
  console.log(
    `\nWrote ${out}. It names people — the folder is gitignored; do not commit or share it.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
