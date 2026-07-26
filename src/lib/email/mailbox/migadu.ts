import "server-only";
import type {
  CreateMailboxInput,
  HostDomain,
  HostMailbox,
  HostResult,
  MailboxHost,
  UpdateMailboxInput,
} from "./types";
import {
  asRecord,
  normalizeDiagnostics,
  normalizeMailbox,
  normalizeRecords,
} from "./migadu-parse";

/**
 * Migadu implementation of MailboxHost.
 *
 * Everything Migadu-shaped lives in this file: its base URL, its Basic-auth
 * scheme, its habit of sending booleans as the strings "true"/"false", and the
 * fact that its activation endpoint is a GET that mutates. None of that leaks
 * past the MailboxHost interface.
 *
 * Chosen because its pricing is per-message rather than per-seat, so onboarding
 * a client with twelve staff costs the platform nothing extra, and because
 * domains, mailboxes and DNS records are all reachable from the API — a client
 * can be stood up without anyone opening a control panel.
 */

const BASE_URL = "https://api.migadu.com/v1";
/** A hung provider must not hang a server action behind it. */
const TIMEOUT_MS = 15_000;

function credentials(): { user: string; key: string } | null {
  const user = process.env.MIGADU_ACCOUNT_EMAIL;
  const key = process.env.MIGADU_API_KEY;
  if (!user || !key) return null;
  return { user, key };
}

export function isMigaduConfigured(): boolean {
  return credentials() !== null;
}

const NOT_CONFIGURED =
  "Mailbox hosting isn't configured yet — add MIGADU_ACCOUNT_EMAIL and MIGADU_API_KEY. See SETUP.md.";

/**
 * One request. Returns the parsed body on 2xx and a sentence on anything else.
 *
 * The API key is never included in a thrown error, a returned message, or a
 * log line — Basic auth puts it in a header, and headers are exactly what gets
 * dumped when someone console.logs a failing request.
 */
async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<HostResult<T>> {
  const creds = credentials();
  if (!creds) return { ok: false, message: NOT_CONFIGURED };

  const auth = Buffer.from(`${creds.user}:${creds.key}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      message: timedOut
        ? "The mail host didn't respond in time. Try again in a moment."
        : "Couldn't reach the mail host.",
    };
  }

  const raw = await response.text();
  let parsed: unknown = undefined;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: providerMessage(parsed) ?? `The mail host refused that (${response.status}).`,
    };
  }

  return { ok: true, data: parsed as T };
}

/** Pull a usable sentence out of whatever shape the error came back in. */
function providerMessage(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  for (const key of ["error", "message", "errors", "detail"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.slice(0, 300);
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
      return value.join("; ").slice(0, 300);
    }
  }
  return null;
}

/** Domains and local parts go into the URL path; neither may smuggle in a segment. */
function safeSegment(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

export const migaduHost: MailboxHost = {
  provider: "migadu",

  async createDomain(domain) {
    // Adopt before creating.
    //
    // Setting a domain up in Migadu's own panel first is the normal path — it
    // is how the founder's own domain was added, and how any client already
    // mid-migration will arrive. A hard failure on "already exists" would
    // dead-end the setup flow on exactly the domains most likely to matter.
    //
    // Checked with a GET rather than by matching the text of a POST error,
    // because error strings are the least stable part of any API.
    const existing = await request<unknown>(
      "GET",
      `/domains/${safeSegment(domain)}`,
    );
    if (existing.ok) {
      // Status stays 'pending' even for a domain the host already considers
      // live: our own flow must still run diagnostics and stamp a cutover
      // before anything is called active. Trusting the host's word here would
      // skip the rollback capture.
      return { ok: true, data: { domain, status: "pending", adopted: true } };
    }
    // Only a genuine "not there" means go ahead and create. A 401 from a bad
    // key must not turn into a confusing create attempt.
    if (existing.status !== 404) return existing;

    // hosted_dns stays false on purpose: Migadu has signalled it intends to
    // stop offering DNS hosting, and the tenant's registrar is where their
    // records belong anyway. create_default_addresses gives us the
    // postmaster/abuse addresses every domain is expected to answer on.
    const result = await request<unknown>("POST", "/domains", {
      name: domain,
      create_default_addresses: "true",
      hosted_dns: "false",
    });
    if (!result.ok) return result;
    return {
      ok: true,
      data: { domain, status: "pending" satisfies HostDomain["status"] },
    };
  },

  async getDomainRecords(domain) {
    const result = await request<unknown>(
      "GET",
      `/domains/${safeSegment(domain)}/records`,
    );
    if (!result.ok) return result;
    return { ok: true, data: normalizeRecords(result.data) };
  },

  async checkDomain(domain) {
    const result = await request<unknown>(
      "GET",
      `/domains/${safeSegment(domain)}/diagnostics`,
    );
    if (!result.ok) return result;
    return { ok: true, data: normalizeDiagnostics(result.data) };
  },

  async activateDomain(domain) {
    // A GET that mutates, which is Migadu's design, not ours. Flagged here so
    // nobody "fixes" it to POST and silently breaks activation.
    const result = await request<unknown>(
      "GET",
      `/domains/${safeSegment(domain)}/activate`,
    );
    if (!result.ok) return result;
    return { ok: true, data: { domain, status: "active" } };
  },

  async listMailboxes(domain) {
    const result = await request<unknown>(
      "GET",
      `/domains/${safeSegment(domain)}/mailboxes`,
    );
    if (!result.ok) return result;
    const root = asRecord(result.data);
    const list = Array.isArray(result.data)
      ? result.data
      : Array.isArray(root?.mailboxes)
        ? (root!.mailboxes as unknown[])
        : [];
    return {
      ok: true,
      data: list
        .map((row) => normalizeMailbox(row, domain))
        .filter((row): row is HostMailbox => row !== null),
    };
  },

  async createMailbox(domain, input: CreateMailboxInput) {
    // password_method "invitation" is the whole point: Migadu mails the setup
    // link and the person chooses their own password. No secret is generated
    // here, returned here, or stored anywhere in this system.
    const result = await request<unknown>(
      "POST",
      `/domains/${safeSegment(domain)}/mailboxes`,
      {
        name: input.displayName,
        local_part: input.localPart,
        password_method: "invitation",
        password_recovery_email: input.inviteEmail,
      },
    );
    if (!result.ok) return result;
    const mailbox = normalizeMailbox(result.data, domain) ?? {
      localPart: input.localPart,
      address: `${input.localPart}@${domain}`,
      displayName: input.displayName,
      maySend: true,
      mayReceive: true,
      mayAccessImap: true,
    };
    return { ok: true, data: mailbox };
  },

  async updateMailbox(domain, localPart, patch: UpdateMailboxInput) {
    const body: Record<string, unknown> = {};
    if (patch.displayName !== undefined) body.name = patch.displayName;
    if (patch.maySend !== undefined) body.may_send = patch.maySend;
    if (patch.mayReceive !== undefined) body.may_receive = patch.mayReceive;
    if (patch.mayAccessImap !== undefined) {
      body.may_access_imap = patch.mayAccessImap;
    }

    const result = await request<unknown>(
      "PUT",
      `/domains/${safeSegment(domain)}/mailboxes/${safeSegment(localPart)}`,
      body,
    );
    if (!result.ok) return result;
    const mailbox = normalizeMailbox(result.data, domain);
    if (!mailbox) {
      return { ok: false, message: "The mail host's reply couldn't be read." };
    }
    return { ok: true, data: mailbox };
  },

  async deleteMailbox(domain, localPart) {
    const result = await request<unknown>(
      "DELETE",
      `/domains/${safeSegment(domain)}/mailboxes/${safeSegment(localPart)}`,
    );
    if (!result.ok) return result;
    return { ok: true, data: undefined };
  },
};
