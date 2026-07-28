import "dotenv/config";

/**
 * Register Yosher as an OAuth client on a Stalwart server.
 *
 *   npm run mail:register-client
 *
 * Stalwart implements RFC 7591 Dynamic Client Registration and — verified
 * against 0.16.15 — accepts it **unauthenticated**. So this is a single POST
 * rather than a trip through the admin UI, which also makes it repeatable:
 * `docker compose down -v` wipes the client, and this puts it back.
 *
 * Prints the `client_id` to put in STALWART_CLIENT_ID. No client secret is
 * requested: `token_endpoint_auth_method: "none"` makes this a PUBLIC client,
 * which is correct because the flow already uses PKCE S256 and a secret adds
 * nothing a stolen code could not already defeat.
 *
 * THE TRAP THIS ENCODES: Stalwart rejects `http://localhost:...` as a redirect
 * URI. RFC 8252 §7.3 requires a loopback **IP literal** — `127.0.0.1` or
 * `[::1]` — because a hostname can be redirected by DNS or a hosts file, and a
 * redirect URI is where an authorization code lands. The error is
 * `invalid_redirect_uri`, and it is easy to misread as a typo.
 *
 * Consequence worth knowing before you run this: the redirect URI must match
 * NEXT_PUBLIC_APP_URL exactly, so local development has to be reached at
 * http://127.0.0.1:3000 rather than http://localhost:3000. Those are different
 * origins to a browser, so a session cookie set on one does not exist on the
 * other — expect to sign in again after switching.
 */

const base = (process.env.STALWART_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const redirectUri = `${appUrl}/api/email/oauth/callback`;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (redirectUri.startsWith("http://") && !isLoopback(redirectUri)) {
    fail(
      `Stalwart will reject the redirect URI "${redirectUri}".\n` +
        "  Over plain http it requires a loopback IP literal, not a hostname.\n" +
        "  Set NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000 (not localhost) and re-run.",
    );
  }

  // Discovery rather than a hardcoded path: the endpoint is the server's to
  // name, and this is the same document the app's own OAuth layer reads.
  const wellKnown = `${base}/.well-known/openid-configuration`;
  const discovery = await fetch(wellKnown, { signal: AbortSignal.timeout(15_000) }).catch(
    () => null,
  );
  if (!discovery?.ok) fail(`Could not read ${wellKnown}. Is the server running?`);
  const config = (await discovery.json()) as { registration_endpoint?: string };
  if (!config.registration_endpoint) {
    fail("This server does not advertise a registration_endpoint.");
  }

  // The advertised endpoint carries the server's CONFIGURED hostname, which is
  // routinely not the host we reached it on. Same rebasing the app does in
  // discovery.ts and jmap/client.ts.
  const advertised = new URL(config.registration_endpoint);
  const reachable = new URL(base);
  const endpoint = `${reachable.protocol}//${reachable.host}${advertised.pathname}`;

  console.log(`\nRegistering at ${endpoint}`);
  console.log(`Redirect URI:  ${redirectUri}\n`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Yosher",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "web",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    fail(
      `Registration failed (HTTP ${response.status}).\n  ` +
        JSON.stringify(payload ?? {}, null, 2).split("\n").join("\n  "),
    );
  }

  const clientId = payload.client_id;
  if (typeof clientId !== "string") fail("The server returned no client_id.");

  console.log("✓ Registered.\n");
  console.log("Put this in .env.local (local dev) or .env:\n");
  console.log(`  STALWART_BASE_URL=${base}`);
  console.log(`  STALWART_CLIENT_ID=${clientId}`);
  console.log(`  NEXT_PUBLIC_APP_URL=${appUrl}`);
  if (payload.client_secret) {
    console.log("\n  A client secret was issued. Set STALWART_CLIENT_SECRET from the");
    console.log("  server's response — it is deliberately not printed here.");
  }
  console.log(
    "\nThen reach the app at " +
      appUrl +
      " — not localhost, they are different\n" +
      "origins and the redirect URI is matched exactly.\n",
  );
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
