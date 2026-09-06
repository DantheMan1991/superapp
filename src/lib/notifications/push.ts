import "server-only";
import http2 from "node:http2";
import { and, eq, isNull } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import { logAudit } from "@/lib/audit";
import {
  apnsConfigFromEnv,
  apnsProviderToken,
  apnsRequestBody,
  apnsRequestHeaders,
  classifyApnsResponse,
  classifyFcmResponse,
  fcmConfigFromEnv,
  fcmRequestBody,
  fcmSendUrl,
  fcmServiceAssertion,
  GOOGLE_TOKEN_URL,
  type ApnsConfig,
  type FcmConfig,
  type FcmErrorBody,
  type PushMessage,
  type PushOutcome,
} from "./push-core";

/**
 * Send one message to every phone a person has registered. The digest run
 * calls this once per person per business per day, after the email; the
 * decisions (what to say, what an answer means) live in push-core.ts.
 *
 * Runs under `withSystem`, justified the way the digest itself is (S2):
 * trusted background code acting for a person whose role the run has already
 * reconciled against Clerk. A device row belongs to a person, not a tenant.
 *
 * Both providers are lazy. With no APNS_* or FCM_* in the environment the
 * function counts the devices it could not reach as `unconfigured` and the
 * run reports that, once, rather than failing — the same posture as every
 * other provider client here.
 */

export interface PushSendResult {
  devices: number;
  delivered: number;
  /** Tokens the provider declared dead; their rows are now disabled. */
  disabled: number;
  failed: number;
  /** Devices on a platform whose sender has no credentials yet. */
  unconfigured: number;
}

const EMPTY: PushSendResult = {
  devices: 0,
  delivered: 0,
  disabled: 0,
  failed: 0,
  unconfigured: 0,
};

const REQUEST_TIMEOUT_MS = 10_000;

// ── APNs ──────────────────────────────────────────────────────────────────

let apnsJwt: { value: string; issuedAt: number } | null = null;
const APNS_JWT_TTL_MS = 50 * 60 * 1000;

function apnsToken(cfg: ApnsConfig): string {
  if (!apnsJwt || Date.now() - apnsJwt.issuedAt > APNS_JWT_TTL_MS) {
    apnsJwt = { value: apnsProviderToken(cfg), issuedAt: Date.now() };
  }
  return apnsJwt.value;
}

function sendApns(
  cfg: ApnsConfig,
  deviceToken: string,
  message: PushMessage,
): Promise<{ outcome: PushOutcome; detail: string }> {
  return new Promise((resolve) => {
    const client = http2.connect(`https://${cfg.host}`);
    const finish = (outcome: PushOutcome, detail: string) => {
      client.close();
      resolve({ outcome, detail });
    };
    client.on("error", (err) => finish("failed", `connect: ${err.message}`));
    const req = client.request({
      ...apnsRequestHeaders(cfg, apnsToken(cfg), message),
      ":path": `/3/device/${deviceToken}`,
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.close();
      finish("failed", "timeout");
    });
    let status = 0;
    let body = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      let reason: string | null = null;
      try {
        reason = body ? (JSON.parse(body) as { reason?: string }).reason ?? null : null;
      } catch {
        reason = null;
      }
      finish(classifyApnsResponse(status, reason), `${status} ${reason ?? ""}`.trim());
    });
    req.on("error", (err) => finish("failed", `request: ${err.message}`));
    req.end(JSON.stringify(apnsRequestBody(message)));
  });
}

// ── FCM ───────────────────────────────────────────────────────────────────

let fcmAccess: { token: string; expiresAt: number } | null = null;
const FCM_ACCESS_TTL_MS = 55 * 60 * 1000;

async function fcmAccessToken(cfg: FcmConfig): Promise<string | null> {
  if (fcmAccess && Date.now() < fcmAccess.expiresAt) return fcmAccess.token;
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: fcmServiceAssertion(cfg),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) return null;
  fcmAccess = { token: data.access_token, expiresAt: Date.now() + FCM_ACCESS_TTL_MS };
  return fcmAccess.token;
}

async function sendFcm(
  cfg: FcmConfig,
  deviceToken: string,
  message: PushMessage,
): Promise<{ outcome: PushOutcome; detail: string }> {
  const access = await fcmAccessToken(cfg);
  if (!access) return { outcome: "unauthorized", detail: "no access token" };
  const res = await fetch(fcmSendUrl(cfg), {
    method: "POST",
    headers: {
      authorization: `Bearer ${access}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(fcmRequestBody(deviceToken, message)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let body: FcmErrorBody | null = null;
  try {
    body = (await res.json()) as FcmErrorBody;
  } catch {
    body = null;
  }
  return {
    outcome: classifyFcmResponse(res.status, body),
    detail: `${res.status} ${body?.error?.status ?? ""}`.trim(),
  };
}

// ── The loop ──────────────────────────────────────────────────────────────

let warnedUnconfigured = false;

async function disableDevice(id: string, reason: string, clerkUserId: string) {
  await withSystem((tx) =>
    tx
      .update(schema.pushDevices)
      .set({ disabledAt: new Date(), disabledReason: reason })
      .where(eq(schema.pushDevices.id, id)),
  );
  await logAudit({
    action: "push.device_disabled",
    actorLabel: "digest",
    targetType: "push_device",
    targetId: id,
    meta: { clerkUserId, reason },
  });
}

export async function sendPushToPerson(
  clerkUserId: string,
  message: PushMessage,
): Promise<PushSendResult> {
  const devices = await withSystem((tx) =>
    tx
      .select()
      .from(schema.pushDevices)
      .where(
        and(
          eq(schema.pushDevices.clerkUserId, clerkUserId),
          isNull(schema.pushDevices.disabledAt),
        ),
      ),
  );
  if (devices.length === 0) return EMPTY;

  const apns = apnsConfigFromEnv(process.env);
  const fcm = fcmConfigFromEnv(process.env);
  const result: PushSendResult = { ...EMPTY, devices: devices.length };

  for (const device of devices) {
    const cfg = device.platform === "ios" ? apns : fcm;
    if (!cfg) {
      result.unconfigured += 1;
      if (!warnedUnconfigured) {
        warnedUnconfigured = true;
        console.warn(
          `push: no ${device.platform === "ios" ? "APNS_*" : "FCM_*"} configuration; phones on that platform get no notification`,
        );
      }
      continue;
    }
    let sent: { outcome: PushOutcome; detail: string };
    try {
      sent =
        device.platform === "ios"
          ? await sendApns(apns!, device.token, message)
          : await sendFcm(fcm!, device.token, message);
    } catch (err) {
      sent = { outcome: "failed", detail: err instanceof Error ? err.message : String(err) };
    }
    switch (sent.outcome) {
      case "delivered":
        result.delivered += 1;
        break;
      case "unregistered":
        result.disabled += 1;
        await disableDevice(device.id, sent.detail, clerkUserId);
        break;
      case "unauthorized":
        result.failed += 1;
        console.error(`push: ${device.platform} sender refused (${sent.detail}) — check the credentials`);
        break;
      default:
        result.failed += 1;
        console.error(`push: ${device.platform} send failed (${sent.detail})`);
    }
  }
  return result;
}
