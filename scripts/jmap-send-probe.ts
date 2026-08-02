import "dotenv/config";

/**
 * Can this mail server hold a message back, and can we call it off?
 *
 *   npm run mail:probe-send
 *
 * WHY THIS DECIDES THE WHOLE DESIGN. "Undo send" and "schedule send" look like
 * two features and are really one question: does the SERVER accept a submission
 * dated in the future, and can a pending one be cancelled? There are two very
 * different products depending on the answer.
 *
 *   • If it does — the message is on the mail server the moment Send is
 *     pressed, held there, and released at the appointed time. Closing the
 *     laptop does not stop it. Undo is "cancel the pending submission".
 *   • If it does NOT — the only honest version is a client-side delay: hold the
 *     message in the browser for a few seconds before submitting at all. That
 *     works for Undo and CANNOT do schedule-send, because nobody's browser is
 *     open at 7am tomorrow.
 *
 * RFC 8621 §7 puts the answer in the submission capability as `maxDelayedSend`,
 * in seconds, where 0 means "no delayed send". It is not optional to check: a
 * server that ignores `sendAt` would send everything IMMEDIATELY while the UI
 * showed a countdown, which is the worst of the three outcomes and invisible
 * until somebody complains that Undo does nothing.
 *
 * IT SUBMITS FOR REAL, so it is LOOPBACK-ONLY and addresses the account to
 * itself. Even if `sendAt` turns out to be ignored, the message goes to the
 * local container's own mailbox and nowhere near a real person.
 */

const rawUrl =
  process.env.STALWART_JMAP_URL ?? "http://127.0.0.1:8080/.well-known/jmap";
const user = process.env.STALWART_USER;
const pass = process.env.STALWART_PASS;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!user || !pass) fail("STALWART_USER and STALWART_PASS must be set in .env.");

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
if (!LOOPBACK.has(new URL(rawUrl).hostname)) {
  fail(
    `refusing to run against ${new URL(rawUrl).hostname}.\n` +
      "  This probe SUBMITS a message. It is limited to a loopback server.",
  );
}

const auth = Buffer.from(`${user}:${pass}`).toString("base64");
const findings: string[] = [];
const confirmed: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function http(url: string, body?: unknown): Promise<Json> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Basic ${auth}`,
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
  const rest = advertised.slice(advertised.indexOf("/", marker + 3));
  return `${from.protocol}//${from.host}${rest}`;
}

const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const SUBMISSION = "urn:ietf:params:jmap:submission";

async function main(): Promise<void> {
  const session = await http(rawUrl);
  const accountId =
    (session.primaryAccounts?.[MAIL] as string) ??
    Object.keys(session.accounts ?? {})[0];
  const apiUrl = rebase(session.apiUrl as string, rawUrl);
  const me = session.username as string;
  console.log(`\nserver   ${me}`);

  const call = async (methodCalls: unknown[][]): Promise<Json[]> => {
    const out = await http(apiUrl, {
      using: [CORE, MAIL, SUBMISSION],
      methodCalls,
    });
    return out.methodResponses;
  };

  // ── THE QUESTION ──────────────────────────────────────────────────────────
  const capability = (session.capabilities ?? {})[SUBMISSION] as Json | undefined;
  console.log("\n--- the submission capability object");
  console.log(
    JSON.stringify(capability ?? null, null, 2)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
  );

  const maxDelayed = capability?.maxDelayedSend;
  if (typeof maxDelayed !== "number" || maxDelayed <= 0) {
    findings.push(
      `maxDelayedSend is ${JSON.stringify(maxDelayed)}. The server will NOT ` +
        "hold a message back, so schedule-send is impossible here and undo has " +
        "to be a client-side delay before submitting at all.",
    );
  } else {
    confirmed.push(
      `maxDelayedSend is ${maxDelayed}s (${Math.round(maxDelayed / 86400)} days), ` +
        "so the server holds messages back and both features are real.",
    );
  }

  // ── Does a future-dated submission actually work? ─────────────────────────
  const [mailboxes] = await call([["Mailbox/get", { accountId, ids: null }, "m"]]);
  const folders = (mailboxes[1].list ?? []) as Json[];
  const drafts = folders.find((f) => f.role === "drafts");

  if (!drafts) fail("no drafts mailbox");

  const [identities] = await call([["Identity/get", { accountId, ids: null }, "i"]]);
  const identity = ((identities[1].list ?? []) as Json[])[0];
  if (!identity) fail("no identity to send as");

  // Two minutes out: long enough to read back and cancel, short enough that a
  // failed cleanup delivers to this container's own mailbox rather than sitting
  // in a queue for a week.
  const sendAt = new Date(Date.now() + 120_000).toISOString().replace(/\.\d+Z$/, "Z");
  console.log(`\n--- submitting with sendAt ${sendAt}`);

  const responses = await call([
    [
      "Email/set",
      {
        accountId,
        create: {
          d: {
            mailboxIds: { [drafts.id]: true },
            keywords: { $draft: true },
            from: [{ name: null, email: me }],
            to: [{ name: "Probe", email: me }],
            subject: "Send probe - delayed submission",
            bodyValues: { text: { value: "Should never actually arrive." } },
            textBody: [{ partId: "text", type: "text/plain" }],
          },
        },
      },
      "e",
    ],
    [
      "EmailSubmission/set",
      {
        accountId,
        create: {
          s: {
            emailId: "#d",
            identityId: identity.id,
            envelope: { mailFrom: { email: me }, rcptTo: [{ email: me }] },
            sendAt,
          },
        },
      },
      "s",
    ],
  ]);

  /** Responses are keyed by the call id, not by position. */
  const byId = (id: string): Json | null =>
    (responses.find((r) => r[2] === id)?.[1] as Json) ?? null;

  const emailResult = byId("e");
  const submitResult = byId("s");
  const emailId = emailResult?.created?.d?.id as string | undefined;

  console.log("\n--- EmailSubmission/set said");
  console.log(
    JSON.stringify(submitResult, null, 2)
      .split("\n")
      .slice(0, 30)
      .map((l) => `    ${l}`)
      .join("\n"),
  );

  const refusedCreate = (submitResult?.notCreated ?? {}).s;
  if (refusedCreate) {
    // THE ANSWER THAT MATTERS MOST. A server that refuses `sendAt` outright is
    // telling us plainly that schedule-send cannot be built on it.
    findings.push(
      `The server REFUSED a future-dated submission: ${JSON.stringify(refusedCreate)}. ` +
        "If the reason names sendAt, delayed send is unsupported and undo must " +
        "be a client-side delay before submitting at all.",
    );
  }

  const submissionId = submitResult?.created?.s?.id as string | undefined;
  let mine: Json | undefined;
  if (submissionId) {
    const got = await call([
      ["EmailSubmission/get", { accountId, ids: [submissionId] }, "g"],
    ]);
    mine = ((got.find((r) => r[2] === "g")?.[1]?.list ?? []) as Json[])[0];
  }

  if (!mine) {
    if (!refusedCreate) {
      findings.push("No EmailSubmission came back, and none was refused either.");
    }
  } else {
    console.log("\n--- the submission the server stored");
    console.log(
      JSON.stringify(mine, null, 2)
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
    );

    if (mine.undoStatus === "pending") {
      confirmed.push(
        'A future-dated submission comes back `undoStatus: "pending"`, which is ' +
          "what makes cancelling it meaningful.",
      );
    } else {
      findings.push(
        `undoStatus is "${mine.undoStatus}" immediately after submitting. The ` +
          "server did NOT hold the message back — it has already gone, and any " +
          "Undo button built on this would be a lie.",
      );
    }

    if (
      typeof mine.sendAt === "string" &&
      mine.sendAt.slice(0, 16) === sendAt.slice(0, 16)
    ) {
      confirmed.push("`sendAt` is stored and echoed back, so scheduling is real.");
    } else {
      findings.push(
        `sendAt came back as ${JSON.stringify(mine.sendAt)} rather than ${sendAt}. ` +
          "The server accepted the field and ignored it, which is the worst " +
          "outcome: a UI showing a countdown over a message already delivered.",
      );
    }

    // ── Can it be called off? ───────────────────────────────────────────────
    const cancelResponses = await call([
      [
        "EmailSubmission/set",
        { accountId, update: { [mine.id]: { undoStatus: "canceled" } } },
        "c",
      ],
    ]);
    const cancelResult =
      (cancelResponses.find((r) => r[2] === "c")?.[1] as Json) ?? {};
    const refusal = (cancelResult.notUpdated ?? {})[mine.id as string];
    if (refusal) {
      findings.push(
        `The server REFUSED to cancel a pending submission: ${JSON.stringify(refusal)}.`,
      );
    } else {
      const afterGot = await call([
        ["EmailSubmission/get", { accountId, ids: [mine.id] }, "a"],
      ]);
      const after = (((afterGot.find((r) => r[2] === "a")?.[1]?.list ?? []) as Json[])[0] ??
        {}) as Json;
      if (after.undoStatus === "canceled") {
        confirmed.push(
          "A pending submission can be CANCELLED and reads back as `canceled`. " +
            "Undo send is a real server-side operation.",
        );
      } else {
        findings.push(
          `After cancelling, undoStatus is "${after.undoStatus}". The cancel was ` +
            "accepted but did not take, so the message may still go out.",
        );
      }
    }
  }
  // ── Cleanup: the draft, whatever happened above ───────────────────────────
  if (emailId) {
    await call([["Email/set", { accountId, destroy: [emailId] }, "d"]]);
    console.log("\ncleanup   probe message destroyed");
  }

  console.log("\n─── CONFIRMED");
  for (const line of confirmed) console.log(`    ✓ ${line}`);
  console.log("\n─── FINDINGS");
  if (findings.length === 0) console.log("    (none — every assumption held)");
  for (const line of findings) console.log(`    ! ${line}`);
  console.log("");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
