import "dotenv/config";

/**
 * Can Yosher grant somebody access to a shared mailbox?
 *
 *   npm run mail:probe-grant
 *
 * WHY THIS COMES BEFORE ANY UI. The delegation slice proved a Group principal
 * with members produces a second account in the member's session. It did that
 * by CREATING both principals itself. The granting UI has the harder problem:
 * the mailboxes already exist, and Yosher made them.
 *
 * And it made them wrong for this. `stalwart.ts` provisions every mailbox with
 * `accountType: "individual"`, because that is what a mailbox is — so `info@`
 * on a real server is a USER principal, not a Group. If a User cannot hold
 * members and cannot be converted, then "grant Dan access to info@" is not an
 * edit to an existing mailbox at all, and the UI has to say something quite
 * different from what it would otherwise say.
 *
 * FIVE QUESTIONS:
 *
 *   1. Can a principal be found by ADDRESS? Yosher stores addresses, not
 *      Stalwart ids, and there is no column linking the two.
 *   2. Can a USER principal hold members — i.e. is any mailbox shareable?
 *   3. Can a User be CONVERTED to a Group, keeping its address and mail?
 *   4. Does adding a member take effect immediately in that member's session?
 *   5. **THE NEGATIVE:** does REMOVING the membership actually revoke it? A
 *      grant that cannot be taken away is not a grant, and `authorizedClient`
 *      already fails closed on a missing account — but only if the server
 *      genuinely stops listing it.
 *
 * IT WRITES — throwaway principals — so it is LOOPBACK-ONLY and destroys
 * everything it made on every exit path.
 */

const rawUrl =
  process.env.STALWART_JMAP_URL ?? "http://127.0.0.1:8080/.well-known/jmap";
const admin = process.env.STALWART_USER;
const adminPass = process.env.STALWART_PASS;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!admin || !adminPass) fail("STALWART_USER and STALWART_PASS must be set in .env.");

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
if (!LOOPBACK.has(new URL(rawUrl).hostname)) {
  fail("This probe creates and destroys mail accounts. Loopback only.");
}

const adminAuth = "Basic " + Buffer.from(`${admin}:${adminPass}`).toString("base64");
const findings: string[] = [];
const confirmed: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function http(url: string, auth: string, body?: unknown): Promise<Json> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: auth,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "follow",
  });
  if (!response.ok) return { __status: response.status };
  return response.json();
}

const CORE = "urn:ietf:params:jmap:core";
const ADMIN = "urn:stalwart:jmap";

const byId = (rs: Json[], id: string): Json =>
  (rs.find((r) => r[2] === id)?.[1] as Json) ?? {};

async function main(): Promise<void> {
  const base = new URL(rawUrl);
  const apiRoot = `${base.protocol}//${base.host}/jmap/`;
  const manage = async (methodCalls: unknown[][]): Promise<Json[]> =>
    ((await http(apiRoot, adminAuth, { using: [CORE, ADMIN], methodCalls }))
      .methodResponses ?? []) as Json[];

  const domain = String(admin).split("@")[1];
  const stamp = String(Date.now()).slice(-8);
  console.log(`\nserver   ${admin}`);

  // Sweep anything an earlier run left behind (members before groups).
  const existing = byId(await manage([["x:Account/get", { ids: null }, "a"]]), "a");
  const stale = ((existing.list ?? []) as Json[])
    .filter((a) => String(a.name ?? "").startsWith("grantprobe"))
    .sort((a, b) => (a["@type"] === "User" ? -1 : 1) - (b["@type"] === "User" ? -1 : 1))
    .map((a) => String(a.id));
  if (stale.length > 0) {
    await manage([["x:Account/set", { destroy: stale }, "s"]]);
    console.log(`--- swept ${stale.length} from an earlier run`);
  }

  const domains = byId(await manage([["x:Domain/get", { ids: null }, "d"]]), "d");
  const domainId = ((domains.list ?? []) as Json[]).find((d) => d.name === domain)?.id;
  if (!domainId) fail(`no domain ${domain}`);

  const made: string[] = [];
  const pass = `Grant-${stamp}-Probe`;

  try {
    // A mailbox provisioned the way Yosher provisions one: an INDIVIDUAL.
    // Plus a person to grant it to.
    const created = byId(
      await manage([
        [
          "x:Account/set",
          {
            create: {
              shared: {
                "@type": "User",
                name: `grantprobeshared${stamp}`,
                domainId,
                description: "Grant probe — a mailbox Yosher would have made",
              },
              person: {
                "@type": "User",
                name: `grantprobeperson${stamp}`,
                domainId,
                description: "Grant probe — the person being granted access",
                credentials: { "0": { "@type": "Password", secret: pass } },
              },
            },
          },
          "c",
        ],
      ]),
      "c",
    );
    if (created.notCreated) fail(`could not create: ${JSON.stringify(created.notCreated)}`);
    const sharedId = created.created.shared.id as string;
    const personId = created.created.person.id as string;
    made.push(personId, sharedId);
    const sharedAddress = created.created.shared.emailAddress as string;
    const personAddress = created.created.person.emailAddress as string;
    console.log(`--- shared ${sharedId} (${sharedAddress})  person ${personId}`);

    // ── 1. Find a principal by ADDRESS ───────────────────────────────────────
    //
    // Yosher stores addresses and has no column holding a Stalwart id, so the
    // UI has to resolve one from the other on every call.
    const all = byId(await manage([["x:Account/get", { ids: null }, "all"]]), "all");
    const found = ((all.list ?? []) as Json[]).filter(
      (a) => String(a.emailAddress ?? "").toLowerCase() === sharedAddress.toLowerCase(),
    );
    if (found.length === 1) {
      confirmed.push(
        "A principal can be found by ADDRESS from `x:Account/get`, which is what " +
          "lets Yosher — which stores addresses and no Stalwart ids — resolve one.",
      );
    } else {
      findings.push(
        `Looking a principal up by address returned ${found.length} matches. The ` +
          "UI would need a stored id instead.",
      );
    }

    // ── 2. Can a USER principal hold members? ────────────────────────────────
    const asMember = byId(
      await manage([
        [
          "x:Account/set",
          { update: { [personId]: { memberGroupIds: { [sharedId]: true } } } },
          "m",
        ],
      ]),
      "m",
    );
    const refused = asMember.notUpdated?.[personId];
    console.log(
      `--- member of a USER principal: ${refused ? JSON.stringify(refused) : "accepted"}`,
    );
    if (refused) {
      findings.push(
        "**A USER PRINCIPAL CANNOT HOLD MEMBERS** — " +
          `${JSON.stringify(refused)}. Yosher provisions every mailbox as an ` +
          "individual (`stalwart.ts`, accountType 'individual'), so no existing " +
          "mailbox is shareable as it stands. Granting access is not an edit to " +
          "a mailbox; something has to make it a Group first.",
      );
    } else {
      confirmed.push(
        "A User principal CAN hold members, so any existing mailbox is shareable " +
          "without being converted — granting is a pure membership edit.",
      );
      // If it worked, does the session actually show it?
      const session = await http(
        rawUrl,
        "Basic " + Buffer.from(`${personAddress}:${pass}`).toString("base64"),
      );
      const ids = Object.keys(session.accounts ?? {});
      console.log(`--- delegate session accounts: ${ids.join(", ")}`);
      if (ids.includes(sharedId)) {
        confirmed.push(
          "Adding the membership takes effect IMMEDIATELY — the delegate's very " +
            "next session lists the shared account, with no restart and no wait.",
        );
      } else {
        findings.push(
          "The membership was accepted but the delegate's session does NOT list " +
            "the account. Granting would appear to work and do nothing.",
        );
      }

      // ── 5. THE NEGATIVE: does removing it revoke? ─────────────────────────
      await manage([
        ["x:Account/set", { update: { [personId]: { memberGroupIds: {} } } }, "r"],
      ]);
      const after = await http(
        rawUrl,
        "Basic " + Buffer.from(`${personAddress}:${pass}`).toString("base64"),
      );
      const afterIds = Object.keys(after.accounts ?? {});
      console.log(`--- after revoking: ${afterIds.join(", ")}`);
      if (!afterIds.includes(sharedId)) {
        confirmed.push(
          "REVOKING WORKS: clearing the membership removes the account from the " +
            "delegate's session, so `authorizedClient`'s fail-closed check has " +
            "something real to detect.",
        );
      } else {
        findings.push(
          "**REVOKING DID NOT TAKE EFFECT.** The account is still in the " +
            "delegate's session after the membership was cleared — a grant that " +
            "cannot be taken away is not a grant.",
        );
      }
    }

    // ── 3. Can a User be CONVERTED to a Group? ───────────────────────────────
    const converted = byId(
      await manage([
        ["x:Account/set", { update: { [sharedId]: { "@type": "Group" } } }, "cv"],
      ]),
      "cv",
    );
    const convertRefused = converted.notUpdated?.[sharedId];
    console.log(
      `--- convert User -> Group: ${convertRefused ? JSON.stringify(convertRefused) : "accepted"}`,
    );
    if (convertRefused) {
      findings.push(
        "**A MAILBOX CANNOT BE CONVERTED FROM USER TO GROUP** — " +
          `${JSON.stringify(convertRefused)}. So a mailbox that already has mail ` +
          "in it cannot be turned into a shared one in place; sharing has to be " +
          "chosen when the mailbox is created.",
      );
    } else {
      confirmed.push(
        "A User principal CAN be converted to a Group in place, keeping its " +
          "address — so an existing `info@` can be made shareable without losing " +
          "the mail already in it.",
      );
      // Does it still hold its address after conversion?
      const reread = byId(
        await manage([["x:Account/get", { ids: [sharedId] }, "rr"]]),
        "rr",
      );
      const row = ((reread.list ?? []) as Json[])[0];
      console.log(
        `--- after conversion: @type=${row?.["@type"]} address=${row?.emailAddress}`,
      );
      if (String(row?.emailAddress).toLowerCase() !== sharedAddress.toLowerCase()) {
        findings.push("Conversion CHANGED the address, which would break delivery.");
      }
    }
  } finally {
    if (made.length > 0) {
      const gone = byId(await manage([["x:Account/set", { destroy: made }, "d"]]), "d");
      console.log(`\n--- cleaned up ${JSON.stringify(gone.destroyed ?? [])}`);
    }
  }

  console.log("\n─── CONFIRMED");
  for (const line of confirmed) console.log(`  ✓ ${line}`);
  if (findings.length > 0) {
    console.log("\n─── FINDINGS");
    for (const line of findings) console.log(`  ⚠ ${line}`);
    console.log("");
  } else {
    console.log("\n─── No findings.\n");
  }
}

void main();
