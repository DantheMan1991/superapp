import "dotenv/config";

/**
 * Read-only probe of the mailbox host's API.
 *
 * Exists because the adapter in src/lib/email/mailbox/migadu.ts was written
 * against Migadu's published docs, not against live responses — the field
 * names for /records and /diagnostics in particular were normalized
 * defensively precisely because they could not be verified at build time.
 * This prints what the API actually returns so those normalizers can be
 * checked against reality instead of assumption.
 *
 *   npm run mailbox:probe -- yosherapp.com
 *
 * STRICTLY READ-ONLY. Every request is a GET. It creates nothing, changes
 * nothing, and activates nothing — running it against a live domain is safe,
 * which is the whole point of having it separate from the app's own flow.
 *
 * The API key is read from the environment and never printed.
 */

const BASE_URL = "https://api.migadu.com/v1";

const user = process.env.MIGADU_ACCOUNT_EMAIL;
const key = process.env.MIGADU_API_KEY;
const domain = process.argv[2];

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!user || !key) {
  fail(
    "MIGADU_ACCOUNT_EMAIL and MIGADU_API_KEY must be set in .env.\n" +
      "  Generate a key at Migadu → My Account → API Keys.",
  );
}
if (!domain) {
  fail("Usage: npm run mailbox:probe -- yourdomain.com");
}

const auth = Buffer.from(`${user}:${key}`).toString("base64");

async function probe(label: string, path: string): Promise<void> {
  process.stdout.write(`\n─── ${label}\n    GET ${path}\n`);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.log(
      `    ✗ request failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
    return;
  }

  const raw = await response.text();
  console.log(`    HTTP ${response.status}`);

  if (raw.length === 0) {
    console.log("    (empty body)");
    return;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    // Full pretty print: the shape is the entire reason this script exists,
    // and truncating it would hide exactly the field we are looking for.
    console.log(
      JSON.stringify(parsed, null, 2)
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    );
  } catch {
    console.log(`    (not JSON) ${raw.slice(0, 500)}`);
  }
}

async function main(): Promise<void> {
  console.log(`\nProbing ${domain} as ${user}`);
  console.log("Read-only — no writes, no activation.\n");

  await probe("Account domains", "/domains");
  await probe("This domain", `/domains/${encodeURIComponent(domain)}`);
  await probe(
    "DNS records (feeds the setup wizard)",
    `/domains/${encodeURIComponent(domain)}/records`,
  );
  await probe(
    "Diagnostics (gates the MX cutover)",
    `/domains/${encodeURIComponent(domain)}/diagnostics`,
  );
  await probe(
    "Mailboxes",
    `/domains/${encodeURIComponent(domain)}/mailboxes`,
  );

  console.log(
    "\nWhat to check against src/lib/email/mailbox/migadu.ts:\n" +
      "  • /records    — do rows use name/value/type, or host/data/record_type?\n" +
      "  • /diagnostics — which field says MX is correct? normalizeDiagnostics()\n" +
      "                   defaults to NOT-ok when it cannot tell, so a mismatch\n" +
      "                   shows up as a cutover that never unlocks.\n" +
      "  • /mailboxes  — is the list bare, or wrapped in { mailboxes: [...] }?\n",
  );
}

void main();
