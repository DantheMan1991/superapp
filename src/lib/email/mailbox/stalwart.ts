import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import type { EmailDnsRecord } from "@/db/schema";
import type {
  CreateMailboxInput,
  HostMailbox,
  MailboxHost,
  UpdateMailboxInput,
} from "./types";

/**
 * Stalwart implementation of MailboxHost.
 *
 * Fundamentally different in shape from `migadu.ts`, and the difference is the
 * point. Migadu is somebody else's API, reached over HTTP, whose response
 * shapes had to be discovered by probing. Stalwart authenticates against an
 * external SQL directory — OUR database — so provisioning a mailbox is a row in
 * `mail_directory_accounts` and there is no network call to make.
 *
 * That is why the interface earns its keep: the callers in `mailboxes.ts` and
 * `provisioning.ts` do not know or care that one host is a REST API and the
 * other is a table.
 *
 * WHAT LIVES WHERE, because it is easy to get backwards:
 *
 *   mailboxes                 Yosher's record that an address exists.
 *                             The source of truth.
 *   mail_directory_accounts   What the mail server reads to authenticate.
 *                             Derived from the above, plus a password hash
 *                             the invitation flow fills in later.
 *   Stalwart's own RocksDB    The actual mail. Never touched from here.
 *
 * Domains are NOT in the directory — Stalwart holds its local domain list in
 * its own configuration, which its management API does not expose. So the
 * domain half of this adapter is deliberately honest about being manual rather
 * than pretending to automate something it cannot.
 */

/**
 * The records a hosted domain needs, given the server's public hostname.
 *
 * Built here rather than fetched, because unlike Migadu there is no endpoint to
 * ask. DKIM is the exception and is genuinely per-domain — Stalwart generates
 * the keys and surfaces them in its admin UI, so the wizard points there rather
 * than inventing a value it cannot know.
 */
function dnsRecordsFor(domain: string, mailHost: string): EmailDnsRecord[] {
  return [
    {
      record: "MX",
      type: "MX",
      name: "@",
      value: mailHost,
      ttl: "Auto",
      priority: 10,
    },
    {
      record: "SPF",
      type: "TXT",
      name: "@",
      value: `v=spf1 mx a:${mailHost} -all`,
      ttl: "Auto",
    },
    {
      record: "DKIM",
      type: "TXT",
      name: `<selector>._domainkey`,
      // The only value we cannot compute. Saying so beats a plausible-looking
      // placeholder somebody would paste into DNS.
      value: `Copy from the mail server's admin page for ${domain}`,
      ttl: "Auto",
    },
    {
      record: "DMARC (optional)",
      type: "TXT",
      name: "_dmarc",
      value: "v=DMARC1; p=none;",
      ttl: "Auto",
    },
  ];
}

function mailHostname(): string {
  return process.env.STALWART_MAIL_HOSTNAME ?? "";
}

const NOT_CONFIGURED =
  "The mail server isn't configured yet — add STALWART_MAIL_HOSTNAME. See SETUP.md.";

export const stalwartHost: MailboxHost = {
  provider: "stalwart",

  /**
   * The server's own hostname — whatever the operator called it. Unconfigured
   * returns "", which mxPointsAt() treats as no match rather than as every
   * match.
   */
  mxNeedle: () => mailHostname().toLowerCase(),

  /**
   * Registering a domain is a change to the mail server's own configuration,
   * which its management API does not expose — verified against a live 0.16
   * instance, whose API the documentation itself calls "deliberately small".
   *
   * So this records intent and returns `pending`. The domain must be added in
   * the server's admin UI, and the check below is what confirms somebody did.
   * Returning success for work that did not happen would be worse than saying
   * so plainly.
   */
  async createDomain(domain) {
    if (!mailHostname()) return { ok: false, message: NOT_CONFIGURED };
    return { ok: true, data: { domain, status: "pending" } };
  },

  async getDomainRecords(domain) {
    const host = mailHostname();
    if (!host) return { ok: false, message: NOT_CONFIGURED };
    return { ok: true, data: dnsRecordsFor(domain, host) };
  },

  /**
   * Whether the domain's mail actually arrives here.
   *
   * Checked against public DNS rather than by asking the server, because the
   * server's opinion of its own configuration is not evidence that the world
   * agrees. The caller cross-checks this against a second lookup before
   * allowing a cutover; two sources agreeing is the gate.
   */
  async checkDomain(domain) {
    const host = mailHostname();
    if (!host) return { ok: false, message: NOT_CONFIGURED };

    let mx: { exchange: string }[] = [];
    try {
      const dns = await import("node:dns/promises");
      mx = await dns.resolveMx(domain);
    } catch {
      return {
        ok: true,
        data: {
          ok: false,
          mxOk: false,
          findings: [`No MX records found for ${domain} yet.`],
          details: null,
        },
      };
    }

    const target = host.toLowerCase();
    const mxOk = mx.some((r) =>
      r.exchange.toLowerCase().replace(/\.$/, "").includes(target),
    );

    return {
      ok: true,
      data: {
        ok: mxOk,
        mxOk,
        findings: mxOk
          ? []
          : [
              `MX records for ${domain} point at ` +
                `${mx.map((r) => r.exchange).join(", ") || "nothing"}, not ${host}.`,
            ],
        details: { mx },
      },
    };
  },

  /**
   * Activation is a no-op with a real meaning.
   *
   * Unlike Migadu, where activation is a distinct call that starts accepting
   * mail, Stalwart accepts mail for any domain in its configuration as soon as
   * the MX points at it. The cutover already happened when DNS changed.
   *
   * The step is kept because the CALLER's flow depends on it: it is where the
   * owner's explicit consent is recorded and where `mx_cutover_at` gets
   * stamped, which the CHECK constraint on `mailbox_domains` requires.
   */
  async activateDomain(domain) {
    if (!mailHostname()) return { ok: false, message: NOT_CONFIGURED };
    return { ok: true, data: { domain, status: "active" } };
  },

  async listMailboxes(domain) {
    const rows = await withSystem((tx) =>
      tx
        .select()
        .from(schema.mailDirectoryAccounts)
        .where(eq(schema.mailDirectoryAccounts.isActive, true)),
    );
    const suffix = `@${domain.toLowerCase()}`;
    return {
      ok: true,
      data: rows
        .filter((r) => r.login.toLowerCase().endsWith(suffix))
        .map((r): HostMailbox => ({
          localPart: r.login.slice(0, r.login.lastIndexOf("@")),
          address: r.login,
          displayName: r.description,
          maySend: true,
          mayReceive: true,
          mayAccessImap: true,
        })),
    };
  },

  /**
   * No remote call to make, and the directory row cannot exist yet — it
   * carries a composite foreign key to the `mailboxes` row the caller is about
   * to insert. The real work happens in afterMailboxCreated().
   *
   * Echoing the input back is honest here: nothing has been created, and the
   * caller's next step is what creates it.
   */
  async createMailbox(domain, input: CreateMailboxInput) {
    if (!mailHostname()) return { ok: false, message: NOT_CONFIGURED };
    return {
      ok: true,
      data: {
        localPart: input.localPart,
        address: `${input.localPart}@${domain}`,
        displayName: input.displayName,
        maySend: true,
        mayReceive: true,
        mayAccessImap: true,
      },
    };
  },

  /**
   * Now the mailbox row exists, so the directory entry can point at it.
   *
   * `password_hash` stays NULL: the person sets their own password through the
   * invitation, and until they do the account exists but cannot authenticate.
   * That is the correct intermediate state — the address can receive mail
   * before anybody has logged into it.
   */
  async afterMailboxCreated(input) {
    await withSystem((tx) =>
      tx
        .insert(schema.mailDirectoryAccounts)
        .values({
          tenantId: input.tenantId,
          mailboxId: input.mailboxId,
          login: input.address.toLowerCase(),
          passwordHash: null,
          accountType: "individual",
          description: input.displayName,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: schema.mailDirectoryAccounts.mailboxId,
          set: {
            login: input.address.toLowerCase(),
            description: input.displayName,
            isActive: true,
            updatedAt: new Date(),
          },
        }),
    );
    return { ok: true, data: undefined };
  },

  async updateMailbox(domain, localPart, patch: UpdateMailboxInput) {
    const login = `${localPart}@${domain}`.toLowerCase();
    const rows = await withSystem((tx) =>
      tx
        .update(schema.mailDirectoryAccounts)
        .set({
          ...(patch.displayName !== undefined
            ? { description: patch.displayName }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.mailDirectoryAccounts.login, login))
        .returning(),
    );
    if (rows.length === 0) {
      return { ok: false, message: `${login} isn't in the mail directory.` };
    }
    return {
      ok: true,
      data: {
        localPart,
        address: login,
        displayName: rows[0].description,
        maySend: patch.maySend ?? true,
        mayReceive: patch.mayReceive ?? true,
        mayAccessImap: patch.mayAccessImap ?? true,
      },
    };
  },

  /**
   * Removes the directory entry, which stops authentication and delivery.
   *
   * It does NOT delete the mail — that lives in the server's own store and is
   * not reachable from here. Deleting the row is the reversible half; if the
   * mail itself must go, that is a deliberate action in the server's admin UI,
   * and keeping the two separate means an accidental click here is survivable.
   */
  async deleteMailbox(domain, localPart) {
    const login = `${localPart}@${domain}`.toLowerCase();
    await withSystem((tx) =>
      tx
        .delete(schema.mailDirectoryAccounts)
        .where(
          and(
            eq(schema.mailDirectoryAccounts.login, login),
            eq(schema.mailDirectoryAccounts.accountType, "individual"),
          ),
        ),
    );
    return { ok: true, data: undefined };
  },
};
