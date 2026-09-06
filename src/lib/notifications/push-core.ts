import { sign as cryptoSign } from "node:crypto";
import type { PersonDigest } from "./digest";
import { deltaSentence, digestSubject } from "./email";

/**
 * The pure half of push: what a notification says, how the two providers are
 * spoken to, and what their answers mean. No network and no database, so
 * every decision here is unit-tested (tests/push-core.test.ts) — the sender in
 * push.ts is a thin loop around these.
 *
 * Push is the morning digest's SECOND CHANNEL, not a new stream of events
 * (docs/modules/notifications.md, "derived obligations, not stored events").
 * One notification per person per business per day, at the same local hour
 * as the email, carrying the same subject, opening the same page.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Root-relative; the app navigates there when the notification is tapped. */
  url: string;
  /** Same id on both providers: a second send the same day replaces the first. */
  collapseId: string;
  /** The count on the icon. Zero clears it. */
  badge: number;
}

/**
 * A notification exists to prompt action. An empty, complete digest ("Nothing
 * needs you today") is worth an email a person can glance at and an app badge
 * of zero; it is not worth waking a phone.
 */
export function shouldPush(digest: PersonDigest): boolean {
  return digest.items.length > 0 || !digest.complete;
}

export function digestPushMessage(
  digest: PersonDigest,
  tenantName: string,
): PushMessage {
  const first = digest.items[0];
  const rest = digest.items.length - 1;
  const lead = first
    ? rest > 0
      ? `${first.title}, and ${rest} more`
      : first.title
    : deltaSentence(digest);
  return {
    title: digestSubject(digest),
    body: `${tenantName}: ${lead}`,
    url: "/dashboard/today",
    collapseId: `digest:${digest.tenantId}:${digest.localDate}`,
    badge: digest.items.length,
  };
}

// ---------------------------------------------------------------------------
// Configuration — lazy, from the environment, like every other provider here
// ---------------------------------------------------------------------------

export interface ApnsConfig {
  teamId: string;
  keyId: string;
  /** The .p8 key's PEM. `\n` escapes are unfolded, so it can live in one env line. */
  privateKey: string;
  bundleId: string;
  host: "api.push.apple.com" | "api.sandbox.push.apple.com";
}

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

type Env = Record<string, string | undefined>;

function pem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

/** Null until every value is set: unset, the digest sends no push to iPhones and says so once. */
export function apnsConfigFromEnv(env: Env): ApnsConfig | null {
  const teamId = env.APNS_TEAM_ID?.trim();
  const keyId = env.APNS_KEY_ID?.trim();
  const privateKey = env.APNS_PRIVATE_KEY;
  const bundleId = env.APNS_BUNDLE_ID?.trim();
  if (!teamId || !keyId || !privateKey || !bundleId) return null;
  return {
    teamId,
    keyId,
    privateKey: pem(privateKey),
    bundleId,
    host:
      env.APNS_ENVIRONMENT?.trim().toLowerCase() === "sandbox"
        ? "api.sandbox.push.apple.com"
        : "api.push.apple.com",
  };
}

export function fcmConfigFromEnv(env: Env): FcmConfig | null {
  const projectId = env.FCM_PROJECT_ID?.trim();
  const clientEmail = env.FCM_CLIENT_EMAIL?.trim();
  const privateKey = env.FCM_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey: pem(privateKey) };
}

// ---------------------------------------------------------------------------
// The two provider tokens — signed here, with nothing but node:crypto
// ---------------------------------------------------------------------------

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

/**
 * APNs authenticates a provider with an ES256 JWT over the team and key ids.
 * Apple wants it renewed at least hourly and not more than every 20 minutes;
 * the sender caches it for 50.
 */
export function apnsProviderToken(
  cfg: Pick<ApnsConfig, "teamId" | "keyId" | "privateKey">,
  nowMs = Date.now(),
): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = b64url(
    JSON.stringify({ iss: cfg.teamId, iat: Math.floor(nowMs / 1000) }),
  );
  const signingInput = `${header}.${claims}`;
  // ieee-p1363: the raw r||s form a JWS wants, not DER.
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key: cfg.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${b64url(signature)}`;
}

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * FCM's HTTP v1 API takes an OAuth access token, which Google issues against
 * an RS256 JWT signed by the service account. Valid for an hour; the sender
 * caches it for 55 minutes.
 */
export function fcmServiceAssertion(
  cfg: Pick<FcmConfig, "clientEmail" | "privateKey">,
  nowMs = Date.now(),
): string {
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat,
      exp: iat + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = cryptoSign("sha256", Buffer.from(signingInput), cfg.privateKey);
  return `${signingInput}.${b64url(signature)}`;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export function apnsRequestBody(message: PushMessage): Record<string, unknown> {
  return {
    aps: {
      alert: { title: message.title, body: message.body },
      badge: message.badge,
      sound: "default",
    },
    url: message.url,
  };
}

export function apnsRequestHeaders(
  cfg: ApnsConfig,
  providerToken: string,
  message: PushMessage,
): Record<string, string> {
  return {
    ":method": "POST",
    authorization: `bearer ${providerToken}`,
    "apns-topic": cfg.bundleId,
    "apns-push-type": "alert",
    "apns-priority": "10",
    "apns-collapse-id": message.collapseId,
    "content-type": "application/json",
  };
}

export function fcmRequestBody(
  token: string,
  message: PushMessage,
): Record<string, unknown> {
  return {
    message: {
      token,
      notification: { title: message.title, body: message.body },
      data: { url: message.url },
      android: {
        collapse_key: message.collapseId,
        priority: "HIGH",
        notification: { notification_count: message.badge },
      },
    },
  };
}

export function fcmSendUrl(cfg: Pick<FcmConfig, "projectId">): string {
  return `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`;
}

// ---------------------------------------------------------------------------
// What an answer means
// ---------------------------------------------------------------------------

/**
 * `unregistered` is the one that changes state: the phone is gone (app
 * uninstalled, token expired) and the row is disabled. `unauthorized` is a
 * configuration problem — every send would fail the same way, so the run
 * says so once and moves on. `failed` is this send, this time.
 */
export type PushOutcome = "delivered" | "unregistered" | "unauthorized" | "failed";

export function classifyApnsResponse(
  status: number,
  reason: string | null | undefined,
): PushOutcome {
  if (status === 200) return "delivered";
  if (
    status === 410 ||
    reason === "BadDeviceToken" ||
    reason === "Unregistered" ||
    reason === "DeviceTokenNotForTopic"
  ) {
    return "unregistered";
  }
  if (
    status === 401 ||
    status === 403 ||
    reason === "InvalidProviderToken" ||
    reason === "ExpiredProviderToken" ||
    reason === "MissingProviderToken" ||
    reason === "TopicDisallowed" ||
    reason === "BadCertificate"
  ) {
    return "unauthorized";
  }
  return "failed";
}

export interface FcmErrorBody {
  error?: {
    status?: string;
    message?: string;
    details?: Array<{ errorCode?: string; "@type"?: string }>;
  };
}

export function classifyFcmResponse(
  status: number,
  body: FcmErrorBody | null | undefined,
): PushOutcome {
  if (status === 200) return "delivered";
  const code =
    body?.error?.details?.find((d) => d.errorCode)?.errorCode ??
    body?.error?.status ??
    null;
  if (status === 404 || code === "UNREGISTERED" || code === "NOT_FOUND") {
    return "unregistered";
  }
  if (
    status === 401 ||
    status === 403 ||
    code === "UNAUTHENTICATED" ||
    code === "PERMISSION_DENIED" ||
    code === "SENDER_ID_MISMATCH"
  ) {
    return "unauthorized";
  }
  return "failed";
}
