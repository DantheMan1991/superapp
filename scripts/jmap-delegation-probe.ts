import "dotenv/config";

/**
 * Can somebody reach a SHARED mailbox through their OWN credentials?
 *
 *   npm run mail:probe-delegation
 *
 * WHY THIS DECIDES THE WHOLE SLICE. `info@` and `accounts@` are boxes nobody
 * owns, and the way every other product does them is a password three people
 * share — which is exactly the thing this module's design refuses. The
 * alternative is delegation: the box is a principal in its own right, and
 * people are GRANTED access to it, so each of them signs in as themselves and
 * access can be taken away one person at a time.
 *
 * RFC 8620 §1.6.2 says a session may list several accounts and that an account
 * is "not necessarily the one the credentials belong to". If that is real here,
 * a delegated mailbox arrives as a SECOND entry in `session.accounts` and the
 * work is matching across all of them instead of only the primary. If it is
 * not, the feature needs a completely different shape and it is much better to
 * learn that now.
 *
 * SIX QUESTIONS, and the last two are the ones a spec cannot answer:
 *
 *   1. Does the server model a shared mailbox at all, and as what?
 *   2. Does a delegate's session list it as a second account?
 *   3. Which fields identify it — is `accounts[id].name` the ADDRESS (which is
 *      all `sessionMatchesAddress` has to compare) or a display name?
 *   4. Can the delegate actually read the shared mailbox's mail?
 *   5. Can the delegate SEND AS the shared address? (An `Identity` in the
 *      delegated account is what makes a reply come from `info@` rather than
 *      from the person, and it is the difference between a shared mailbox and
 *      a shared inbox.)
 *   6. **THE NEGATIVE.** Can a signed-in user read an account they were NEVER
 *      granted, just by naming its id? Every read in this app passes an
 *      accountId to the server. If the server does not enforce the grant, the
 *      accountId column this slice adds becomes the only thing standing
 *      between one tenant's staff and another's mail — and it is a column, not
 *      a permission. A server that answers is a finding that stops the slice.
 *
 * IT WRITES — two throwaway principals and a message — so it is LOOPBACK-ONLY
 * and destroys everything it made on every exit path.
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
  fail(
    "This probe creates and destroys mail accounts. It is limited to a loopback server.",
  );
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
  if (!response.ok) fail(`${response.status} from ${url}`);
  return response.json();
}

function rebase(advertised: string, reached: string): string {
  const from = new URL(reached);
  const marker = advertised.indexOf("://");
  return `${from.protocol}//${from.host}${advertised.slice(advertised.indexOf("/", marker + 3))}`;
}

const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const SUBMISSION = "urn:ietf:params:jmap:submission";
const ADMIN = "urn:stalwart:jmap";

const byId = (rs: Json[], id: string): Json =>
  (rs.find((r) => r[2] === id)?.[1] as Json) ?? {};

async function main(): Promise<void> {
  const base = new URL(rawUrl);
  const apiRoot = `${base.protocol}//${base.host}/jmap/`;

  const manage = async (methodCalls: unknown[][]): Promise<Json[]> =>
    (await http(apiRoot, adminAuth, { using: [CORE, ADMIN], methodCalls }))
      .methodResponses as Json[];

  const adminSession = await http(rawUrl, adminAuth);
  console.log(`\nserver   ${adminSession.username}`);

  const domain = String(admin).split("@")[1];
  const stamp = String(Date.now()).slice(-8);
  const sharedAddress = `probe-shared-${stamp}@${domain}`;
  const delegateAddress = `probe-delegate-${stamp}@${domain}`;
  // Never a real credential: this account exists for seconds and is destroyed
  // in the finally block below.
  const delegatePass = `Probe-${stamp}-Delegation`;
  const delegateAuth =
    "Basic " + Buffer.from(`${delegateAddress}:${delegatePass}`).toString("base64");

  // The address is SERVER-SET, derived from the principal's name and its
  // domain — supplying `emailAddress` is refused with `invalidPatch`. So the
  // domain has to be looked up and referenced by id.
  // Sweep anything a previous run left behind. A probe that creates principals
  // has to assume it will be killed halfway at least once, and a server slowly
  // filling with `probe-*` accounts is its own small mess.
  const existing = byId(await manage([["x:Account/get", { ids: null }, "a"]]), "a");
  const stale = ((existing.list ?? []) as Json[])
    .filter((a) => String(a.name ?? "").startsWith("probe-"))
    // Members before groups, same ordering rule as the cleanup below.
    .sort((a, b) => (a["@type"] === "User" ? -1 : 1) - (b["@type"] === "User" ? -1 : 1))
    .map((a) => String(a.id));
  if (stale.length > 0) {
    const swept = byId(await manage([["x:Account/set", { destroy: stale }, "s"]]), "s");
    console.log(`--- swept ${JSON.stringify(swept.destroyed ?? [])} from an earlier run`);
  }

  const domains = byId(await manage([["x:Domain/get", { ids: null }, "d"]]), "d");
  const domainRow = ((domains.list ?? []) as Json[]).find((d) => d.name === domain);
  if (!domainRow) fail(`No domain "${domain}" on this server.`);
  const domainId = domainRow.id as string;

  // ── 1. Does the server model a shared mailbox, and as what? ────────────────
  //
  // A Group principal is the candidate: `x:Account` carries `memberGroupIds`,
  // which is a grant expressed as membership rather than as a shared password.
  const created = byId(
    await manage([
      [
        "x:Account/set",
        {
          create: {
            shared: {
              "@type": "Group",
              name: `probe-shared-${stamp}`,
              domainId,
              description: "Delegation probe — shared mailbox",
            },
          },
        },
        "c",
      ],
    ]),
    "c",
  );
  if (created.notCreated?.shared) {
    fail(
      "The server refused to create a Group principal: " +
        `${JSON.stringify(created.notCreated.shared)}. A shared mailbox would ` +
        "have to be modelled some other way.",
    );
  }
  const sharedId = created.created.shared.id as string;
  confirmed.push(
    "A shared mailbox is a first-class principal (`@type: Group`) with its own " +
      "address — not a password somebody hands round.",
  );

  let delegateId = "";
  try {
    const madeUser = byId(
      await manage([
        [
          "x:Account/set",
          {
            create: {
              person: {
                "@type": "User",
                name: `probe-delegate-${stamp}`,
                domainId,
                description: "Delegation probe — the person granted access",
                credentials: { "0": { "@type": "Password", secret: delegatePass } },
                // THE GRANT ITSELF: access to the shared box is membership,
                // held on the person, revocable one person at a time.
                memberGroupIds: { [sharedId]: true },
              },
            },
          },
          "c",
        ],
      ]),
      "c",
    );
    if (madeUser.notCreated?.person) {
      fail(
        "Could not create the delegate: " +
          `${JSON.stringify(madeUser.notCreated.person)}`,
      );
    }
    delegateId = madeUser.created.person.id as string;
    console.log(`--- shared ${sharedId}   delegate ${delegateId}`);

    // ── 2 & 3. The delegate's OWN session: how many accounts, named how? ─────
    const session = await http(rawUrl, delegateAuth);
    const accounts = (session.accounts ?? {}) as Record<string, Json>;
    const primaryId = (session.primaryAccounts ?? {})[MAIL] as string | undefined;
    const apiUrl = rebase(session.apiUrl as string, rawUrl);

    console.log(`\n--- the delegate's session`);
    console.log(`    username         ${session.username}`);
    console.log(`    primaryAccounts  ${primaryId}`);
    console.log(`    accounts         ${JSON.stringify(accounts, null, 2).split("\n").join("\n    ")}`);

    const ids = Object.keys(accounts);
    if (ids.length < 2) {
      fail(
        `The delegate's session lists ${ids.length} account(s). Membership did ` +
          "NOT produce a second account, so delegation cannot be built on the " +
          "session's account list.",
      );
    }
    confirmed.push(
      `A delegated mailbox IS a second entry in \`session.accounts\` (${ids.length} ` +
        "accounts for one person), reached with the delegate's own credentials.",
    );

    const sharedEntry = accounts[sharedId];
    if (!sharedEntry) {
      fail(
        `The shared account id ${sharedId} is not among the session's accounts ` +
          `(${ids.join(", ")}). The management id and the session id differ, which ` +
          "would have to be reconciled before anything could be stored.",
      );
    }
    confirmed.push(
      "The management principal id and the session account id are THE SAME " +
        "string, so a stored accountId means the same thing to both APIs.",
    );

    // Which field carries the address? This is the entire input to the matcher.
    const sharedName = String(sharedEntry.name ?? "");
    if (sharedName.toLowerCase() === sharedAddress.toLowerCase()) {
      confirmed.push(
        "`accounts[id].name` on a delegated account is the ADDRESS, so matching " +
          "a mailbox to an account is a comparison rather than a lookup.",
      );
    } else {
      findings.push(
        `accounts[${sharedId}].name is "${sharedName}", NOT the address ` +
          `"${sharedAddress}". Matching cannot compare against it; the address ` +
          "would have to come from an Identity or a Principal lookup.",
      );
    }

    if (sharedEntry.isPersonal === false && accounts[primaryId!]?.isPersonal === true) {
      confirmed.push(
        "`isPersonal` distinguishes the two: false on the delegated box, true on " +
          "the person's own — a reliable way to label a shared mailbox in the UI " +
          "without guessing from the address.",
      );
    } else {
      findings.push(
        `isPersonal is ${JSON.stringify(sharedEntry.isPersonal)} on the shared ` +
          `account and ${JSON.stringify(accounts[primaryId!]?.isPersonal)} on the ` +
          "primary — it does not distinguish them here.",
      );
    }

    if (sharedEntry.isReadOnly === true) {
      findings.push(
        "The delegated account is `isReadOnly: true` — the delegate could read " +
          "the shared box but not file, flag or reply. Worth surfacing rather " +
          "than discovering on the first click.",
      );
    } else {
      confirmed.push("The delegated account is writable (`isReadOnly: false`).");
    }

    const sharedCaps = Object.keys(sharedEntry.accountCapabilities ?? {});
    console.log(`\n--- delegated accountCapabilities: ${sharedCaps.join(", ")}`);

    const call = async (methodCalls: unknown[][], using = [CORE, MAIL]): Promise<Json[]> =>
      (await http(apiUrl, delegateAuth, { using, methodCalls })).methodResponses as Json[];

    // ── 4. Can the delegate actually READ the shared mailbox? ────────────────
    const sharedBoxes = byId(
      await call([["Mailbox/get", { accountId: sharedId, ids: null }, "m"]]),
      "m",
    );
    if (sharedBoxes.type === "error" || !Array.isArray(sharedBoxes.list)) {
      fail(
        "The session lists the shared account but Mailbox/get against it failed: " +
          `${JSON.stringify(sharedBoxes)}`,
      );
    }
    const sharedInbox = (sharedBoxes.list as Json[]).find((f) => f.role === "inbox");
    console.log(
      `--- shared mailboxes: ${(sharedBoxes.list as Json[]).map((f) => f.name).join(", ")}`,
    );
    if (!sharedInbox) fail("The shared account has no inbox.");
    confirmed.push(
      "The delegate can list the shared account's mailboxes with their OWN " +
        "token — no shared password anywhere in the flow.",
    );

    // …and write to it, which is what makes it a working mailbox rather than a
    // read-only view. A message the delegate files must survive being read back.
    const wrote = byId(
      await call([
        [
          "Email/set",
          {
            accountId: sharedId,
            create: {
              e: {
                mailboxIds: { [sharedInbox.id]: true },
                keywords: { $seen: true },
                from: [{ name: null, email: sharedAddress }],
                to: [{ name: null, email: sharedAddress }],
                subject: `Delegation probe ${stamp}`,
                bodyValues: { t: { value: "probe" } },
                textBody: [{ partId: "t", type: "text/plain" }],
              },
            },
          },
          "w",
        ],
      ]),
      "w",
    );
    if (wrote.notCreated?.e || wrote.type === "error") {
      findings.push(
        "The delegate can READ the shared mailbox but not WRITE to it: " +
          `${JSON.stringify(wrote.notCreated?.e ?? wrote)}. Filing, flagging and ` +
          "replying would all fail.",
      );
    } else {
      confirmed.push(
        "The delegate can create a message in the shared account — reading, " +
          "filing and flagging all work through the delegated id.",
      );
    }

    // Does `myRights` reflect the grant? It is what the label menu and every
    // move action already key off, so a delegated box that reports rights
    // correctly needs no new permission model.
    console.log(
      `--- shared inbox myRights: ${JSON.stringify(sharedInbox.myRights ?? null)}`,
    );

    // ── 5. Can the delegate SEND AS the shared address? ──────────────────────
    const identities = byId(
      await call([["Identity/get", { accountId: sharedId, ids: null }, "i"]], [
        CORE,
        SUBMISSION,
      ]),
      "i",
    );
    if (identities.type === "error") {
      findings.push(
        `Identity/get against the delegated account failed: ${JSON.stringify(identities)}. ` +
          "The delegate could read the shared box but every reply would go out " +
          "under their own address.",
      );
    } else {
      const addresses = ((identities.list ?? []) as Json[]).map((i) => String(i.email));
      console.log(`--- identities in the shared account: ${addresses.join(", ")}`);
      if (addresses.some((a) => a.toLowerCase() === sharedAddress.toLowerCase())) {
        confirmed.push(
          `The delegated account carries an Identity for ${sharedAddress}, so a ` +
            "reply goes out FROM the shared address rather than from the person — " +
            "which is the difference between a shared mailbox and a shared inbox.",
        );
      } else {
        findings.push(
          `The delegated account has no Identity for ${sharedAddress} ` +
            `(found: ${addresses.join(", ") || "none"}). Sending as the shared ` +
            "address is not available and the compose From list must not offer it.",
        );
      }
    }

    // ── 6. THE NEGATIVE: an account that was never granted ───────────────────
    //
    // The one that decides whether the server enforces the grant or merely
    // advertises it. Everything in this app passes an accountId to the server;
    // if naming somebody else's id is enough, the stored column is the only
    // guard and that is not a guard.
    const adminAccountId = (adminSession.primaryAccounts ?? {})[MAIL] as string;
    const trespass = byId(
      await call([["Mailbox/get", { accountId: adminAccountId, ids: null }, "x"]]),
      "x",
    );
    const refused =
      trespass.type === "error" ||
      trespass.type === "forbidden" ||
      trespass.type === "accountNotFound" ||
      !Array.isArray(trespass.list);
    console.log(
      `\n--- naming a NON-granted account (${adminAccountId}): ${JSON.stringify(trespass).slice(0, 200)}`,
    );
    if (refused) {
      confirmed.push(
        `THE NEGATIVE HOLDS: naming an account the delegate was never granted is ` +
          `refused by the SERVER (${String(trespass.type ?? "no list")}) — the grant is ` +
          "enforced where it is held, not by us remembering to filter.",
      );
    } else {
      findings.push(
        "THE SERVER SERVED AN ACCOUNT THAT WAS NEVER GRANTED. A stored accountId " +
          "would be the only thing keeping one person out of another's mail, and " +
          "a column is not a permission. Do not build delegation on this server.",
      );
    }

    // ── 7. WHICH SETTINGS ARE PER-ACCOUNT, AND THEREFORE SHARED? ─────────────
    //
    // The question this slice really turns on. Five Yosher tables are scoped to
    // one person, and the founding property was "your mail is yours". A shared
    // mailbox does not break that for anything stored in OUR database — each
    // person gets their own `mail_accounts` row and everything hangs off it.
    //
    // But three features do NOT store anything of ours. Rules are a Sieve
    // script on the mail server, the auto-reply is a VacationResponse, and the
    // signature is on an Identity — and all three are SINGLETONS PER ACCOUNT.
    // If the delegate can write them on the shared account, then one person's
    // "rule" silently becomes everybody's rule, and our per-user table would be
    // recording a private preference for a shared effect. That is a lie the
    // schema cannot detect and the UI has to tell the truth about.
    //
    // Asking is much better than reasoning: a server that REFUSED these on a
    // delegated account would settle it the other way entirely.
    const shareable: Record<string, boolean> = {};

    const vacation = byId(
      await call(
        [
          [
            "VacationResponse/set",
            {
              accountId: sharedId,
              update: { singleton: { isEnabled: false, textBody: `probe ${stamp}` } },
            },
            "v",
          ],
        ],
        [CORE, "urn:ietf:params:jmap:vacationresponse"],
      ),
      "v",
    );
    shareable["auto-reply (VacationResponse)"] =
      vacation.type !== "error" && !vacation.notUpdated?.singleton;

    const identity = byId(
      await call([["Identity/get", { accountId: sharedId, ids: null }, "i2"]], [
        CORE,
        SUBMISSION,
      ]),
      "i2",
    );
    const sharedIdentityId = ((identity.list ?? []) as Json[])[0]?.id as string | undefined;
    if (sharedIdentityId) {
      const sig = byId(
        await call(
          [
            [
              "Identity/set",
              {
                accountId: sharedId,
                update: { [sharedIdentityId]: { textSignature: `probe ${stamp}` } },
              },
              "s2",
            ],
          ],
          [CORE, SUBMISSION],
        ),
        "s2",
      );
      shareable["signature (Identity)"] =
        sig.type !== "error" && !sig.notUpdated?.[sharedIdentityId];
    }

    const sieve = byId(
      await call(
        [
          [
            "SieveScript/set",
            {
              accountId: sharedId,
              create: { s: { name: `probe-${stamp}`, blobId: null } },
            },
            "z",
          ],
        ],
        [CORE, "urn:ietf:params:jmap:sieve"],
      ),
      "z",
    );
    // A missing blob is an invalidProperties failure, NOT a permission one —
    // what is being asked here is whether the account is addressable at all.
    const sieveRefused =
      sieve.type === "forbidden" ||
      String(sieve.notCreated?.s?.type ?? "") === "forbidden";
    shareable["rules (SieveScript)"] = !sieveRefused;
    if (sieve.created?.s?.id) {
      await call(
        [["SieveScript/set", { accountId: sharedId, destroy: [sieve.created.s.id] }, "zd"]],
        [CORE, "urn:ietf:params:jmap:sieve"],
      );
    }

    console.log(`\n--- per-account settings on the SHARED account`);
    for (const [what, writable] of Object.entries(shareable)) {
      console.log(`    ${writable ? "WRITABLE" : "refused "}  ${what}`);
    }
    const sharedSettings = Object.entries(shareable)
      .filter(([, w]) => w)
      .map(([what]) => what);
    if (sharedSettings.length > 0) {
      findings.push(
        `A delegate can write these on the SHARED account: ${sharedSettings.join("; ")}. ` +
          "Each is a SINGLETON per account, so one person's change applies to " +
          "everyone using the box — while Yosher stores rules per user. The " +
          "storage would record a private preference for a shared effect, and " +
          "a colleague would not see the rule filing their mail. These must " +
          "either be refused on a delegated mailbox or labelled as shared.",
      );
    }

    // And the same question for the SESSION: the non-granted account must not
    // be listed either, or the picker would offer mailboxes nobody may open.
    if (Object.keys(accounts).includes(adminAccountId)) {
      findings.push(
        "The delegate's session LISTS an account they were not granted. The " +
          "account list cannot be treated as an entitlement.",
      );
    } else {
      confirmed.push(
        "The session lists ONLY the accounts this person may use, so the account " +
          "list is itself the entitlement — which is what makes matching across " +
          "it safe.",
      );
    }
  } finally {
    // Everything this probe made, destroyed — on success, on a finding, and on
    // a throw. Destroying the principals takes their mail with them.
    //
    // THE MEMBER GOES FIRST. Destroying the group while somebody is still a
    // member is refused with `objectIsLinked`, and a destroy list is processed
    // in order — so the reverse order silently leaves the shared box behind
    // while reporting a successful cleanup for the other one.
    const cleanup = [delegateId, sharedId].filter((id) => id.length > 0);
    const gone = byId(
      await manage([["x:Account/set", { destroy: cleanup }, "d"]]),
      "d",
    );
    console.log(
      `\n--- cleaned up ${JSON.stringify(gone.destroyed ?? [])}` +
        (gone.notDestroyed
          ? `  NOT DESTROYED: ${JSON.stringify(gone.notDestroyed)}`
          : ""),
    );
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
