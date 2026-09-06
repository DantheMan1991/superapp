import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PersonDigest } from "@/lib/notifications/digest";
import {
  apnsConfigFromEnv,
  apnsProviderToken,
  apnsRequestBody,
  apnsRequestHeaders,
  classifyApnsResponse,
  classifyFcmResponse,
  digestPushMessage,
  fcmConfigFromEnv,
  fcmRequestBody,
  fcmSendUrl,
  fcmServiceAssertion,
  shouldPush,
} from "@/lib/notifications/push-core";
import {
  readNativeBridge,
  tokenFromRegistration,
  urlFromNotificationAction,
} from "@/lib/native-bridge";

/**
 * Push is the digest's second channel: same subject, same page, at the same
 * hour. Everything here is what the sender decides without a network.
 */

function digest(overrides: Partial<PersonDigest> = {}): PersonDigest {
  return {
    tenantId: "t1",
    profileId: "p1",
    clerkUserId: "user_1",
    email: "dan@example.com",
    name: "Dan",
    role: "owner",
    localDate: "2026-09-06",
    items: [
      { key: "inv:1", title: "Invoice 1043 is 6 days overdue", urgency: "overdue", dueOn: "2026-08-31", href: "/dashboard/m/accounting/invoices/1" },
      { key: "task:2", title: "Call the feed supplier", urgency: "due", dueOn: "2026-09-06", href: "/dashboard/m/work/2" },
      { key: "task:3", title: "Sign the lease", urgency: "upcoming", dueOn: "2026-09-08", href: "/dashboard/m/work/3" },
    ] as PersonDigest["items"],
    delta: { first: false, newKeys: ["task:2"], carriedKeys: ["inv:1", "task:3"], resolvedKeys: [] } as PersonDigest["delta"],
    failed: [],
    complete: true,
    ...overrides,
  };
}

const decode = (segment: string) =>
  JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;

describe("what a notification says", () => {
  it("carries the digest's subject, the business, and the first item", () => {
    const m = digestPushMessage(digest(), "Hilltop Farm");
    expect(m.title).toBe("3 things need you (1 new)");
    expect(m.body).toBe("Hilltop Farm: Invoice 1043 is 6 days overdue, and 2 more");
    expect(m.url).toBe("/dashboard/today");
    expect(m.badge).toBe(3);
    expect(m.collapseId).toBe("digest:t1:2026-09-06");
  });

  it("does not say 'and 0 more'", () => {
    const one = digest({ items: digest().items.slice(0, 1), delta: { first: true, newKeys: ["inv:1"], carriedKeys: [], resolvedKeys: [] } as PersonDigest["delta"] });
    expect(digestPushMessage(one, "Test").body).toBe("Test: Invoice 1043 is 6 days overdue");
  });

  it("wakes a phone for work, or for a list it could not complete, and not for nothing", () => {
    expect(shouldPush(digest())).toBe(true);
    expect(shouldPush(digest({ items: [], complete: true }))).toBe(false);
    expect(shouldPush(digest({ items: [], complete: false, failed: [{ slug: "crm", label: "CRM" }] }))).toBe(true);
    const empty = digestPushMessage(digest({ items: [], complete: false, failed: [{ slug: "crm", label: "CRM" }] }), "Test");
    expect(empty.title).toBe("Your daily summary (incomplete)");
    expect(empty.badge).toBe(0);
  });
});

describe("configuration from the environment", () => {
  it("is null until every value is present, and unfolds a one-line key", () => {
    expect(apnsConfigFromEnv({ APNS_TEAM_ID: "T", APNS_KEY_ID: "K" })).toBeNull();
    const apns = apnsConfigFromEnv({
      APNS_TEAM_ID: " T1 ",
      APNS_KEY_ID: "K1",
      APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
      APNS_BUNDLE_ID: "com.yosherapp.app",
      APNS_ENVIRONMENT: "Sandbox",
    });
    expect(apns).toEqual({
      teamId: "T1",
      keyId: "K1",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      bundleId: "com.yosherapp.app",
      host: "api.sandbox.push.apple.com",
    });
    expect(apnsConfigFromEnv({ ...{ APNS_TEAM_ID: "T", APNS_KEY_ID: "K", APNS_PRIVATE_KEY: "x", APNS_BUNDLE_ID: "b" } })?.host).toBe("api.push.apple.com");
    expect(fcmConfigFromEnv({ FCM_PROJECT_ID: "p" })).toBeNull();
    expect(fcmConfigFromEnv({ FCM_PROJECT_ID: "p", FCM_CLIENT_EMAIL: "e@p.iam", FCM_PRIVATE_KEY: "k" })).toEqual({ projectId: "p", clientEmail: "e@p.iam", privateKey: "k" });
  });
});

describe("provider tokens", () => {
  it("signs an ES256 JWT for APNs that the key verifies", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = apnsProviderToken({ teamId: "TEAM", keyId: "KEY", privateKey: pem }, 1_700_000_000_000);
    const [h, c, s] = jwt.split(".");
    expect(decode(h)).toEqual({ alg: "ES256", kid: "KEY" });
    expect(decode(c)).toEqual({ iss: "TEAM", iat: 1_700_000_000 });
    const ok = cryptoVerify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });

  it("signs an RS256 assertion for Google that the key verifies", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = fcmServiceAssertion({ clientEmail: "svc@p.iam.gserviceaccount.com", privateKey: pem }, 1_700_000_000_000);
    const [h, c, s] = jwt.split(".");
    expect(decode(h)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(c)).toMatchObject({ iss: "svc@p.iam.gserviceaccount.com", aud: "https://oauth2.googleapis.com/token", iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(cryptoVerify("sha256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
});

describe("requests", () => {
  const message = digestPushMessage(digest(), "Hilltop Farm");

  it("shape the APNs and FCM bodies the providers expect", () => {
    expect(apnsRequestBody(message)).toEqual({
      aps: { alert: { title: message.title, body: message.body }, badge: 3, sound: "default" },
      url: "/dashboard/today",
    });
    const headers = apnsRequestHeaders({ teamId: "T", keyId: "K", privateKey: "x", bundleId: "com.yosherapp.app", host: "api.push.apple.com" }, "jwt", message);
    expect(headers).toMatchObject({ ":method": "POST", authorization: "bearer jwt", "apns-topic": "com.yosherapp.app", "apns-push-type": "alert", "apns-collapse-id": "digest:t1:2026-09-06" });
    expect(fcmRequestBody("tok", message)).toEqual({
      message: {
        token: "tok",
        notification: { title: message.title, body: message.body },
        data: { url: "/dashboard/today" },
        android: { collapse_key: "digest:t1:2026-09-06", priority: "HIGH", notification: { notification_count: 3 } },
      },
    });
    expect(fcmSendUrl({ projectId: "yosher-app" })).toBe("https://fcm.googleapis.com/v1/projects/yosher-app/messages:send");
  });
});

describe("what an answer means", () => {
  it("APNs: a dead token disables, a refused credential is configuration, the rest is this send", () => {
    expect(classifyApnsResponse(200, null)).toBe("delivered");
    expect(classifyApnsResponse(410, "Unregistered")).toBe("unregistered");
    expect(classifyApnsResponse(400, "BadDeviceToken")).toBe("unregistered");
    expect(classifyApnsResponse(403, "InvalidProviderToken")).toBe("unauthorized");
    expect(classifyApnsResponse(400, "TopicDisallowed")).toBe("unauthorized");
    expect(classifyApnsResponse(429, "TooManyRequests")).toBe("failed");
    expect(classifyApnsResponse(500, null)).toBe("failed");
  });

  it("FCM: the same three answers from Google's error shapes", () => {
    expect(classifyFcmResponse(200, null)).toBe("delivered");
    expect(classifyFcmResponse(404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } })).toBe("unregistered");
    expect(classifyFcmResponse(403, { error: { status: "PERMISSION_DENIED" } })).toBe("unauthorized");
    expect(classifyFcmResponse(401, null)).toBe("unauthorized");
    expect(classifyFcmResponse(400, { error: { status: "INVALID_ARGUMENT" } })).toBe("failed");
    expect(classifyFcmResponse(503, { error: { status: "UNAVAILABLE" } })).toBe("failed");
  });
});

describe("the shell's bridge, as the page sees it", () => {
  const plugin = {
    checkPermissions: async () => ({ receive: "granted" }),
    requestPermissions: async () => ({ receive: "granted" }),
    register: async () => {},
    addListener: () => ({ remove: () => {} }),
  };

  it("is absent in a browser, and in a shell without the plugin", () => {
    expect(readNativeBridge(undefined)).toBeNull();
    expect(readNativeBridge({})).toBeNull();
    expect(readNativeBridge({ Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" } })).toBeNull();
    const noPlugin = readNativeBridge({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "android", Plugins: {} } });
    expect(noPlugin).toEqual({ platform: "android", push: null });
  });

  it("finds the plugin when the shell carries it", () => {
    const bridge = readNativeBridge({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: { PushNotifications: plugin } } });
    expect(bridge?.platform).toBe("ios");
    expect(bridge?.push).toBe(plugin);
  });

  it("reads a token and a tap's destination defensively", () => {
    expect(tokenFromRegistration({ value: "a".repeat(64) })).toBe("a".repeat(64));
    expect(tokenFromRegistration({ value: "short" })).toBeNull();
    expect(tokenFromRegistration(null)).toBeNull();
    expect(urlFromNotificationAction({ notification: { data: { url: "/dashboard/m/work/3" } } })).toBe("/dashboard/m/work/3");
    expect(urlFromNotificationAction({ notification: { data: { url: "https://evil.example" } } })).toBe("/dashboard/today");
    expect(urlFromNotificationAction({ notification: { data: { url: "//evil.example" } } })).toBe("/dashboard/today");
    expect(urlFromNotificationAction({})).toBe("/dashboard/today");
  });
});
