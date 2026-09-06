import "./lib/load-env";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

/**
 * `npm run push:probe -- --email dan@example.com` — send one test notification
 * to every phone a person has registered, through the same sender the
 * morning digest uses. The end-to-end check for the mobile app's push
 * (docs/modules/mobile-app.md) that does not wait for 7am.
 *
 *   npm run push:probe -- --email dan@example.com
 *   npm run push:probe -- --email dan@example.com --service-account C:/path/to/firebase-adminsdk.json
 *   npm run push:probe -- --email dan@example.com --apns-key C:/path/to/AuthKey_KEYID.p8 --apns-key-id KEYID --apns-team-id TEAMID
 *
 * Credentials come from the environment (APNS_*, FCM_* — the same names
 * Vercel holds) or, for a laptop that has the files but not the variables,
 * from the flags above, which set those variables for this process only.
 * Nothing is printed but counts.
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function credentialsFromFlags() {
  const serviceAccount = arg("--service-account");
  if (serviceAccount) {
    const sa = JSON.parse(readFileSync(serviceAccount, "utf8")) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!sa.project_id || !sa.client_email || !sa.private_key) {
      throw new Error("that file is not a Firebase service account");
    }
    process.env.FCM_PROJECT_ID = sa.project_id;
    process.env.FCM_CLIENT_EMAIL = sa.client_email;
    process.env.FCM_PRIVATE_KEY = sa.private_key;
  }
  const apnsKey = arg("--apns-key");
  if (apnsKey) {
    process.env.APNS_PRIVATE_KEY = readFileSync(apnsKey, "utf8");
    if (arg("--apns-key-id")) process.env.APNS_KEY_ID = arg("--apns-key-id");
    if (arg("--apns-team-id")) process.env.APNS_TEAM_ID = arg("--apns-team-id");
    process.env.APNS_BUNDLE_ID ??= "com.yosherapp.app";
  }
}

async function main() {
  const email = arg("--email")?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npm run push:probe -- --email <address> [--service-account <json>] [--apns-key <p8> --apns-key-id <id> --apns-team-id <id>]");
    process.exit(1);
  }
  credentialsFromFlags();
  if (!globalThis.WebSocket) neonConfig.webSocketConstructor = ws;

  // Imported after the environment is settled: the senders read it lazily,
  // and the database module reads DATABASE_URL at first use.
  const { schema, withSystem } = await import("../src/db");
  const { sendPushToPerson } = await import("../src/lib/notifications/push");

  const person = await withSystem((tx) =>
    tx.query.profiles.findFirst({ where: eq(schema.profiles.email, email) }),
  );
  if (!person) {
    console.error(`No profile with the address ${email}.`);
    process.exit(1);
  }
  const result = await sendPushToPerson(person.clerkUserId, {
    title: "Yosher is connected",
    body: "This is a test notification from the Yosher app. Tap it to open what needs you.",
    url: "/dashboard/today",
    collapseId: `probe:${Date.now()}`,
    badge: 0,
  });
  console.log(
    `${result.devices} phone(s): ${result.delivered} delivered, ${result.failed} failed, ${result.disabled} disabled as dead, ${result.unconfigured} on a platform with no credentials.`,
  );
  if (result.devices === 0) {
    console.log("Nothing registered yet: open the app on a phone, sign in, allow notifications, then run this again.");
  }
  process.exit(result.delivered > 0 || result.devices === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
