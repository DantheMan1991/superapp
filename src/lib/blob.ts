import "server-only";

/**
 * Vercel Blob plumbing. The @vercel/blob SDK reads BLOB_READ_WRITE_TOKEN
 * from the environment itself; this guard exists so features fail with a
 * pointed message (provider convention — lazy, build stays key-free).
 */
export function assertBlobConfigured(): void {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set. See SETUP.md.");
  }
}

/**
 * All accounting receipts live under this per-tenant prefix. The upload
 * token route and the registration action both enforce it — a client can
 * only ever write into (and register from) its own tenant's namespace.
 */
export function receiptPathPrefix(tenantId: string): string {
  return `acct/${tenantId}/receipts/`;
}
