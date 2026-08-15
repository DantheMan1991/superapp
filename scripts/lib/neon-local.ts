import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

/**
 * Point the Neon serverless driver at a plain Postgres running beside it,
 * through a WebSocket proxy.
 *
 * WHY A PROXY INSTEAD OF SWAPPING THE DRIVER. The database suite is
 * latency-bound — it spends its time waiting on round trips, not computing —
 * so moving Postgres into the CI runner is worth a lot. But the app talks to
 * Neon over a WebSocket, and a test run that swaps in `pg` would be certifying
 * a driver production does not use. Transaction handling, pooling and error
 * shapes are exactly the things the isolation suite depends on, so the driver
 * stays identical and a proxy does the translating.
 *
 * NO-OP UNLESS `NEON_LOCAL_PROXY` IS SET, which is what keeps this safe. Every
 * ordinary run — a developer's machine, a CI job against a real Neon branch —
 * never enters this path at all.
 *
 * Called from BOTH `tests/setup/database-guard.ts` and
 * `scripts/ci-provision-db.ts`; a second copy of these four settings would be
 * the kind of drift that produces a confusing connection error months later.
 */
export function configureNeonForLocalProxy(): boolean {
  const proxy = process.env.NEON_LOCAL_PROXY;
  if (!proxy) return false;

  if (!globalThis.WebSocket) {
    neonConfig.webSocketConstructor = ws;
  }
  // `host:port` of the proxy, e.g. `localhost:5433`.
  //
  // No `?address=` here on purpose: the proxy is configured with `APPEND_PORT`
  // pointing at the Postgres container, so IT decides the target. Passing an
  // address from this side would send the proxy the connection string's host —
  // `localhost` — which inside the proxy's own container is the proxy, not the
  // database. That mistake connects to nothing and reports very little.
  neonConfig.wsProxy = () => `${proxy}/v1`;
  // Everything below is the difference between talking to Neon over the public
  // internet and talking to a container on the same machine: there is no TLS
  // to negotiate and nothing to pipeline it with.
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
  return true;
}
