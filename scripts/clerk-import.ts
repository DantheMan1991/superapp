import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ClerkApi } from "./lib/clerk-api";
import {
  buildCreateOrganizationBody,
  buildCreateUserBody,
  findPassword,
  keyKind,
  parsePasswordCsv,
  primaryEmail,
  validateMapping,
  type Mapping,
  type PasswordRow,
  type Snapshot,
} from "./lib/clerk-migration";

/**
 * `npm run clerk:import` — recreate a snapshot's users, organizations and
 * memberships on the TARGET instance, and write the old → new id mapping
 * `scripts/clerk-remap.ts` runs on. Step 3 of
 * docs/runbooks/clerk-production-cutover.md.
 *
 *   npm run clerk:import -- --dry-run
 *   npm run clerk:import -- --passwords ~/Downloads/users.csv
 *   npm run clerk:import -- --snapshot f.json --mapping g.json --with-invitations
 *
 * Reads CLERK_TARGET_SECRET_KEY, which must be a LIVE key (`--allow-dev-target`
 * rehearses against a second development instance). Idempotent: a person is
 * found by `external_id` (their old id) or by email before one is created, an
 * organization by the old id in its metadata or by slug, a membership by the
 * pair — so a rerun after a failure finishes the job instead of doubling it.
 *
 * Invitations are only re-sent with `--with-invitations`, because creating one
 * emails the invitee.
 */

type Json = Record<string, unknown>;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const flag = (name: string) => process.argv.includes(name);

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

async function main() {
  const targetKey = process.env.CLERK_TARGET_SECRET_KEY;
  const targetKind = keyKind(targetKey);
  if (!targetKey || targetKind === "unknown") {
    console.error(
      "Set CLERK_TARGET_SECRET_KEY to the secret key of the instance to import INTO (the production one, sk_live_…).",
    );
    process.exit(1);
  }
  if (targetKind !== "live" && !flag("--allow-dev-target")) {
    console.error(
      "CLERK_TARGET_SECRET_KEY is not a live key. Pass --allow-dev-target to rehearse against a development instance.",
    );
    process.exit(1);
  }
  if (
    targetKey === process.env.CLERK_SECRET_KEY ||
    targetKey === process.env.CLERK_SOURCE_SECRET_KEY
  ) {
    console.error("The target key is the source instance's key. Nothing to move.");
    process.exit(1);
  }

  const dryRun = flag("--dry-run");
  const snapshotPath =
    arg("--snapshot") ?? path.join("clerk-migration", "snapshot.json");
  const mappingPath =
    arg("--mapping") ?? path.join("clerk-migration", "mapping.json");
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

  let passwords: PasswordRow[] = [];
  const csvPath = arg("--passwords");
  if (csvPath) {
    const parsed = parsePasswordCsv(readFileSync(csvPath, "utf8"));
    if (parsed.missing.length > 0) {
      console.error(
        `${csvPath} has no ${parsed.missing.join(" / ")} column (columns found: ${parsed.columns.join(", ")}). Export it from the SOURCE instance: Clerk dashboard → Configure → Settings → "Export all users".`,
      );
      process.exit(1);
    }
    passwords = parsed.rows;
    console.log(`Password hashes for ${passwords.length} people read from ${csvPath}.`);
  } else {
    console.log(
      'No --passwords CSV: anyone without a social sign-in sets a new password from "Forgot password".',
    );
  }

  const api = new ClerkApi(targetKey);
  const mapping: Mapping = {
    createdAt: new Date().toISOString(),
    source: snapshot.source.keyKind,
    target: targetKind,
    users: {},
    organizations: {},
  };
  const say = (line: string) => console.log(`${dryRun ? "[dry-run] " : ""}${line}`);

  // ── Users ────────────────────────────────────────────────────────────────
  console.log(`\nUsers (${snapshot.users.length})`);
  for (const user of snapshot.users) {
    const email = primaryEmail(user) ?? "(no email)";
    let found = (await api.list<Json>("/users", { external_id: user.id }))[0] ?? null;
    let how = "by external_id";
    if (!found && email !== "(no email)") {
      found = (await api.list<Json>("/users", { email_address: email }))[0] ?? null;
      how = "by email";
    }
    if (found) {
      mapping.users[user.id] = String(found.id);
      say(`  ${email}  exists ${how} → ${found.id}`);
      if (!found.external_id && !dryRun) {
        await api.request("PATCH", `/users/${found.id}`, {
          body: { external_id: user.id },
        });
      }
      continue;
    }
    const password = findPassword(passwords, user);
    const social =
      user.externalAccounts.length > 0
        ? `; ${user.externalAccounts.join(",")} re-links by email on first sign-in`
        : "";
    if (dryRun) {
      say(`  ${email}  would create (${password ? "password hash carried" : "no password"}${social})`);
      continue;
    }
    const created = await api.request<Json>("POST", "/users", {
      body: buildCreateUserBody(user, password),
    });
    mapping.users[user.id] = String(created.id);
    say(`  ${email}  created → ${created.id} (${password ? "password hash carried" : "no password"}${social})`);
  }

  // ── Organizations ────────────────────────────────────────────────────────
  console.log(`\nOrganizations (${snapshot.organizations.length})`);
  const existingOrgs = await api.list<Json>("/organizations");
  for (const org of snapshot.organizations) {
    const found =
      existingOrgs.find(
        (o) => record(o.public_metadata).migrated_from_org_id === org.id,
      ) ??
      (org.slug ? existingOrgs.find((o) => o.slug === org.slug) : undefined) ??
      null;
    if (found) {
      mapping.organizations[org.id] = String(found.id);
      say(`  ${org.name}  exists → ${found.id}`);
      continue;
    }
    // Whoever created it, else its first admin — created_by becomes the
    // organization's first admin membership on the target.
    const admins = snapshot.memberships
      .filter((m) => m.organizationId === org.id && m.role === "org:admin")
      .map((m) => m.userId);
    const creator =
      [org.createdBy, ...admins]
        .map((id) => (id ? mapping.users[id] : undefined))
        .find((id): id is string => Boolean(id)) ?? null;
    if (dryRun) {
      say(`  ${org.name}  would create (created_by ${creator ?? "nobody yet"})`);
      continue;
    }
    const created = await api.request<Json>("POST", "/organizations", {
      body: buildCreateOrganizationBody(org, creator),
    });
    mapping.organizations[org.id] = String(created.id);
    say(`  ${org.name}  created → ${created.id}`);
  }

  // ── Memberships ──────────────────────────────────────────────────────────
  console.log(`\nMemberships (${snapshot.memberships.length})`);
  for (const m of snapshot.memberships) {
    const orgId = mapping.organizations[m.organizationId];
    const userId = mapping.users[m.userId];
    const label = `${m.userId} in ${m.organizationId} as ${m.role}`;
    if (!orgId || !userId) {
      say(`  ${label}  skipped: the ${orgId ? "user" : "organization"} is not on the target yet`);
      continue;
    }
    const current = await api.list<Json>(`/organizations/${orgId}/memberships`);
    const existing = current.find(
      (row) => record(row.public_user_data).user_id === userId,
    );
    if (existing && existing.role === m.role) {
      say(`  ${label}  exists`);
      continue;
    }
    if (dryRun) {
      say(`  ${label}  would ${existing ? `change role ${existing.role} → ${m.role}` : "create"}`);
      continue;
    }
    if (existing) {
      await api.request("PATCH", `/organizations/${orgId}/memberships/${userId}`, {
        body: { role: m.role },
      });
    } else {
      await api.request("POST", `/organizations/${orgId}/memberships`, {
        body: { user_id: userId, role: m.role },
      });
    }
    say(`  ${label}  ${existing ? "role updated" : "created"}`);
  }

  // ── Invitations ──────────────────────────────────────────────────────────
  const pending = snapshot.invitations.filter((i) => i.status === "pending");
  if (pending.length > 0) {
    console.log(`\nPending invitations (${pending.length})`);
    for (const invitation of pending) {
      const orgId = mapping.organizations[invitation.organizationId];
      const label = `${invitation.emailAddress} → ${invitation.organizationId} as ${invitation.role}`;
      if (!flag("--with-invitations")) {
        say(`  ${label}  not re-sent (pass --with-invitations, or invite again from the Team page)`);
        continue;
      }
      if (!orgId || dryRun) {
        say(`  ${label}  ${orgId ? "would re-send" : "skipped: the organization is not on the target yet"}`);
        continue;
      }
      const inviter = snapshot.memberships
        .filter((m) => m.organizationId === invitation.organizationId && m.role === "org:admin")
        .map((m) => mapping.users[m.userId])
        .find((id): id is string => Boolean(id));
      await api.request("POST", `/organizations/${orgId}/invitations`, {
        body: {
          email_address: invitation.emailAddress,
          role: invitation.role,
          inviter_user_id: inviter,
        },
      });
      say(`  ${label}  re-sent`);
    }
  }

  if (dryRun) {
    console.log("\nDry run: nothing was created and no mapping was written.");
    return;
  }
  mkdirSync(path.dirname(mappingPath), { recursive: true });
  writeFileSync(mappingPath, JSON.stringify(validateMapping(mapping), null, 2));
  console.log(
    `\nWrote ${mappingPath}: ${Object.keys(mapping.users).length} users, ${Object.keys(mapping.organizations).length} organizations mapped. Next: npm run clerk:remap -- --dry-run`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
