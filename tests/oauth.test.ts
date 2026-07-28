import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  decryptToken,
  encryptToken,
  isTokenEncryptionConfigured,
} from "@/lib/email/oauth/crypto";
import {
  clearDiscoveryCache,
  parseOidcConfig,
  rebaseOnto,
  SCOPE_MAIL,
  SCOPE_OFFLINE,
} from "@/lib/email/oauth/discovery";
import {
  buildAuthorizeUrl,
  createPkcePair,
  describeOauthError,
  needsRefresh,
  parseTokenResponse,
} from "@/lib/email/oauth/flow";

/**
 * Mailbox OAuth.
 *
 * The tokens this handles are the most dangerous values the platform stores —
 * a live access token reads someone's mail, and a refresh token mints more
 * indefinitely. So the encryption tests care less about "does it round trip"
 * than about what happens when something is wrong: a tampered ciphertext, a
 * rotated key, a missing key.
 *
 * The discovery fixture is the live response from a real Stalwart instance.
 */

const TEST_KEY = "3Yx8kQvN2mR7pL9wZ4tB6nH1jF5sD0aC8eG2iK7uO3Q=";

describe("token encryption", () => {
  // Reuses APP_ENCRYPTION_KEY and @/lib/crypto rather than a second key: both
  // would live in the same environment on the same server, so two keys is two
  // things to rotate and no additional protection.
  const original = process.env.APP_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = TEST_KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = original;
  });

  it("round trips a token", () => {
    const token = "ya29.a0AfB_by-not-a-real-token";
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it("produces different ciphertext every time", () => {
    // A fresh IV per encryption. Reusing one under GCM is catastrophic rather
    // than merely weak, and identical ciphertexts would be the visible symptom.
    const a = encryptToken("same-token");
    const b = encryptToken("same-token");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("same-token");
    expect(decryptToken(b)).toBe("same-token");
  });

  it("refuses a tampered ciphertext instead of returning garbage", () => {
    // GCM authenticates; a flipped bit fails the tag rather than decrypting
    // to plausible nonsense.
    const parts = encryptToken("original-token").split(".");
    const flipped = Buffer.from(parts[2], "base64");
    flipped[0] ^= 0xff;
    parts[2] = flipped.toString("base64");
    expect(decryptToken(parts.join("."))).toBeNull();
  });

  it("returns null rather than throwing on anything malformed", () => {
    // The one place this diverges from decryptSecret, which throws. Every
    // failure means the same thing operationally — the connection is unusable
    // and the person must reconnect — and an exception here would turn one
    // dead connection into a broken inbox page.
    for (const bad of ["", "nonsense", "only.two", "a.b.c.d"]) {
      expect(decryptToken(bad)).toBeNull();
    }
  });

  it("cannot decrypt with a different key", () => {
    const stored = encryptToken("secret");
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(decryptToken(stored)).toBeNull();
  });

  it("reports itself unconfigured without a usable key", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(isTokenEncryptionConfigured()).toBe(false);

    process.env.APP_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(isTokenEncryptionConfigured()).toBe(false);
  });
});

describe("OIDC discovery", () => {
  beforeEach(clearDiscoveryCache);

  /** Verbatim from a live Stalwart instance, 2026-07-27. */
  const LIVE = {
    issuer: "https://mail.yosherdev.com",
    authorization_endpoint: "https://mail.yosherdev.com/login",
    token_endpoint: "https://mail.yosherdev.com/auth/token",
    userinfo_endpoint: "https://mail.yosherdev.com/auth/userinfo",
    registration_endpoint: "https://mail.yosherdev.com/auth/register",
    scopes_supported: [
      "openid",
      "offline_access",
      "urn:ietf:params:oauth:scope:mail",
      "urn:ietf:params:oauth:scope:contacts",
      "urn:ietf:params:oauth:scope:calendars",
    ],
    grant_types_supported: [
      "authorization_code",
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:device_code",
    ],
    code_challenge_methods_supported: ["S256"],
  };

  it("reads the live configuration", () => {
    const config = parseOidcConfig(LIVE, "https://mail.yosherdev.com")!;
    expect(config.tokenEndpoint).toBe("https://mail.yosherdev.com/auth/token");
    expect(config.supportsPkceS256).toBe(true);
    expect(config.supportsRefreshToken).toBe(true);
    expect(config.scopesSupported).toContain(SCOPE_MAIL);
  });

  it("rebases endpoints onto the host we actually reached", () => {
    // Stalwart builds every advertised URL from its CONFIGURED hostname, not
    // the request Host header. Locally that name does not resolve, so a client
    // following discovery literally sends the browser somewhere dead.
    const config = parseOidcConfig(LIVE, "http://localhost:8080")!;
    expect(config.authorizationEndpoint).toBe("http://localhost:8080/login");
    expect(config.tokenEndpoint).toBe("http://localhost:8080/auth/token");
  });

  it("leaves a URL alone when the host already matches", () => {
    expect(
      rebaseOnto("https://mail.example.com", "https://mail.example.com/auth/token"),
    ).toBe("https://mail.example.com/auth/token");
  });

  it("keeps the server's paths rather than guessing them", () => {
    // Guessing paths is exactly what discovery exists to avoid.
    expect(rebaseOnto("http://localhost:8080", "https://elsewhere/weird/path")).toBe(
      "http://localhost:8080/weird/path",
    );
  });

  it("rejects a configuration missing the endpoints the flow needs", () => {
    const noToken: Record<string, unknown> = { ...LIVE };
    delete noToken.token_endpoint;
    expect(parseOidcConfig(noToken, "http://localhost:8080")).toBeNull();
    expect(parseOidcConfig(null, "http://localhost:8080")).toBeNull();
  });

  it("notices a server that cannot refresh", () => {
    // Without refresh the connection dies at first expiry and the person is
    // asked to reconnect forever. Worth knowing before we offer it.
    const config = parseOidcConfig(
      { ...LIVE, grant_types_supported: ["authorization_code"] },
      "http://localhost:8080",
    )!;
    expect(config.supportsRefreshToken).toBe(false);
  });
});

describe("PKCE and the authorize URL", () => {
  const config = parseOidcConfig(
    {
      authorization_endpoint: "http://localhost:8080/login",
      token_endpoint: "http://localhost:8080/auth/token",
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
    },
    "http://localhost:8080",
  )!;

  it("generates a verifier in the length RFC 7636 allows", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challenge).not.toBe(verifier);
    // base64url: no padding, no + or /
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never repeats a verifier", () => {
    const seen = new Set(Array.from({ length: 50 }, () => createPkcePair().verifier));
    expect(seen.size).toBe(50);
  });

  it("asks for mail and offline access, and nothing else", () => {
    // Least privilege: no contacts, no calendars, even though the server
    // offers them.
    const url = new URL(
      buildAuthorizeUrl(config, {
        clientId: "yosher",
        redirectUri: "https://app.example.com/api/email/oauth/callback",
        state: "st",
        challenge: "ch",
      }),
    );
    expect(url.searchParams.get("scope")).toBe(`${SCOPE_MAIL} ${SCOPE_OFFLINE}`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("omits PKCE when the server does not support it", () => {
    const noPkce = parseOidcConfig(
      {
        authorization_endpoint: "http://localhost:8080/login",
        token_endpoint: "http://localhost:8080/auth/token",
        grant_types_supported: ["authorization_code"],
      },
      "http://localhost:8080",
    )!;
    const url = new URL(
      buildAuthorizeUrl(noPkce, {
        clientId: "yosher",
        redirectUri: "https://app.example.com/cb",
        state: "st",
        challenge: "ch",
      }),
    );
    expect(url.searchParams.has("code_challenge")).toBe(false);
  });
});

describe("token responses", () => {
  it("resolves expires_in to an absolute time", () => {
    // The response is the only moment we know what the duration is relative to.
    const now = new Date("2026-07-27T12:00:00Z");
    const tokens = parseTokenResponse(
      { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "a b" },
      now,
    )!;
    expect(tokens.expiresAt?.toISOString()).toBe("2026-07-27T13:00:00.000Z");
    expect(tokens.scope).toEqual(["a", "b"]);
  });

  it("treats a missing refresh token as absent, not empty", () => {
    // Callers must read null as "keep the one you have" — a non-rotating
    // server returns no refresh token, and overwriting would break the
    // connection at the next expiry.
    expect(parseTokenResponse({ access_token: "at" })!.refreshToken).toBeNull();
    expect(parseTokenResponse({ access_token: "at", refresh_token: "" })!.refreshToken).toBeNull();
  });

  it("rejects a response with no access token however cheerful", () => {
    expect(parseTokenResponse({ token_type: "Bearer" })).toBeNull();
    expect(parseTokenResponse({ error: "invalid_grant" })).toBeNull();
    expect(parseTokenResponse(null)).toBeNull();
  });

  it("has no expiry when the server states none", () => {
    expect(parseTokenResponse({ access_token: "at" })!.expiresAt).toBeNull();
  });

  it("translates OAuth errors into something a person can act on", () => {
    expect(describeOauthError("invalid_grant")).toContain("connecting again");
    expect(describeOauthError("access_denied")).toContain("declined");
    expect(describeOauthError("weird_new_code")).toContain("weird_new_code");
  });
});

describe("refresh timing", () => {
  const now = new Date("2026-07-27T12:00:00Z");

  it("refreshes early enough that a token cannot expire mid-request", () => {
    expect(needsRefresh(new Date("2026-07-27T12:00:30Z"), now)).toBe(true);
    expect(needsRefresh(new Date("2026-07-27T12:05:00Z"), now)).toBe(false);
  });

  it("treats an already-expired token as needing refresh", () => {
    expect(needsRefresh(new Date("2026-07-27T11:00:00Z"), now)).toBe(true);
  });

  it("never refreshes a token with no stated expiry", () => {
    expect(needsRefresh(null, now)).toBe(false);
  });
});
