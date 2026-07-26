import type { EmailDnsRecord } from "@/db/schema";

/**
 * The seam between "we host this tenant's mail" and *who* actually holds it.
 *
 * There is one implementation today (Migadu). The interface exists because the
 * second one is foreseeable — a self-hosted Stalwart server once volume makes
 * per-message pricing worse than running a box — and because the migration
 * between them should be a data move, not a rewrite of everything that touches
 * a mailbox.
 *
 * So this interface is deliberately expressed in terms every mail host has
 * (domains, DNS records, mailboxes, local parts) and never in terms only
 * Migadu has. Anything Migadu-shaped stays inside migadu.ts.
 *
 * Every method returns a result union rather than throwing. A provider being
 * unreachable is an ordinary Tuesday, not an exception — and the callers here
 * are server actions that must turn it into a sentence for an owner.
 */

export type HostResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; status?: number };

export type HostDomainStatus = "pending" | "dns_ready" | "active" | "failed";

export interface HostDomain {
  domain: string;
  /** The host's own view of whether this domain is live. */
  status: HostDomainStatus;
  /**
   * True when the domain already existed at the host and we took it over
   * rather than creating it. The normal path for a domain someone set up in
   * the host's own panel first, and for any client mid-migration.
   */
  adopted?: boolean;
}

/**
 * What the host says is still missing. `ok` is the only field callers branch
 * on; `details` is opaque and exists to be shown verbatim to whoever is
 * fighting a DNS panel, because a specific complaint beats "not verified".
 */
export interface HostDiagnostics {
  ok: boolean;
  /** True once the domain's MX actually points at this host. */
  mxOk: boolean;
  /** Human-readable findings, safe to render. */
  findings: string[];
  /** Raw provider payload, stored for support. Never rendered blind. */
  details: unknown;
}

export interface HostMailbox {
  localPart: string;
  address: string;
  displayName: string;
  maySend: boolean;
  mayReceive: boolean;
  mayAccessImap: boolean;
}

export interface CreateMailboxInput {
  localPart: string;
  displayName: string;
  /**
   * Where the host sends its setup invitation. Providing this selects the
   * invitation flow, which is the only flow this codebase uses: the host mails
   * a link, the person sets their own password, and no secret ever exists on
   * our side to be logged, leaked, or subpoenaed.
   */
  inviteEmail: string;
}

export interface UpdateMailboxInput {
  displayName?: string;
  maySend?: boolean;
  mayReceive?: boolean;
  mayAccessImap?: boolean;
}

export interface MailboxHost {
  readonly provider: "migadu" | "stalwart";

  /** Register the domain with the host. Does NOT redirect any mail yet. */
  createDomain(domain: string): Promise<HostResult<HostDomain>>;

  /** The records the tenant must publish. Includes the MX that does the takeover. */
  getDomainRecords(domain: string): Promise<HostResult<EmailDnsRecord[]>>;

  /** Ask the host to re-check DNS and report what it sees. Read-only. */
  checkDomain(domain: string): Promise<HostResult<HostDiagnostics>>;

  /**
   * The cutover. Separate call, separate consent, deliberately not folded into
   * createDomain: this is the moment the domain's mail starts arriving here
   * instead of wherever it used to.
   */
  activateDomain(domain: string): Promise<HostResult<HostDomain>>;

  listMailboxes(domain: string): Promise<HostResult<HostMailbox[]>>;
  createMailbox(
    domain: string,
    input: CreateMailboxInput,
  ): Promise<HostResult<HostMailbox>>;
  updateMailbox(
    domain: string,
    localPart: string,
    patch: UpdateMailboxInput,
  ): Promise<HostResult<HostMailbox>>;
  /** Destroys the mailbox and its mail at the host. Callers must confirm first. */
  deleteMailbox(domain: string, localPart: string): Promise<HostResult<void>>;
}
