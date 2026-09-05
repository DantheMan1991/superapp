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
 * The read-write token, passed EXPLICITLY to every SDK call. Without it
 * the SDK prefers ambient OIDC credentials when it can find any, which
 * fails outside deployed functions (learned in production debugging).
 */
export function blobToken(): string {
  assertBlobConfigured();
  return process.env.BLOB_READ_WRITE_TOKEN!;
}

/**
 * All accounting receipts live under this per-tenant prefix. The upload
 * token route and the registration action both enforce it — a client can
 * only ever write into (and register from) its own tenant's namespace.
 */
export function receiptPathPrefix(tenantId: string): string {
  return `acct/${tenantId}/receipts/`;
}

/**
 * The Documents module's namespaces. `kind` is split out now, unused beyond
 * "files", so that generated documents and signature artifacts land in their
 * own prefixes later without re-homing anything already stored.
 *
 * Existing `acct/…` receipts keep their pathnames forever — the global partial
 * unique on documents.blob_pathname spans both prefixes and they cannot
 * collide.
 */
export type DocumentBlobKind = "files" | "generated" | "signatures" | "signed";

export function dmsPathPrefix(
  tenantId: string,
  kind: DocumentBlobKind = "files",
): string {
  return `docs/${tenantId}/${kind}/`;
}

/**
 * The brand kit's logos (`brand_kits.logo_pathname`). Layer 0, not a module's:
 * the invoice PDF reads from here and Accounting may not import Marketing.
 */
export function brandPathPrefix(tenantId: string): string {
  return `brand/${tenantId}/logos/`;
}

/**
 * A site's photos (Marketing slice 5, ADR 0023): the one derivative the
 * platform made from each upload. Sibling of the logo prefix for the same
 * reason it is here rather than in the module: the public routes stream
 * from it and the upload door validates against it.
 */
export function sitePhotoPathPrefix(tenantId: string): string {
  return `sites/${tenantId}/photos/`;
}

/**
 * Every prefix a tenant is allowed to own, across modules. Used to validate
 * any client-supplied pathname before it is trusted as a blob location.
 *
 * Traversal is checked explicitly rather than assumed: a pathname is only ever
 * compared by prefix, and ".." would let a prefix-passing string still escape.
 */
export function isTenantBlobPath(tenantId: string, pathname: string): boolean {
  if (pathname.length === 0 || pathname.length > 500) return false;
  if (pathname.includes("..") || pathname.startsWith("/")) return false;
  if (pathname.includes("\\")) return false;
  return (
    pathname.startsWith(receiptPathPrefix(tenantId)) ||
    pathname.startsWith(dmsPathPrefix(tenantId, "files")) ||
    pathname.startsWith(dmsPathPrefix(tenantId, "generated")) ||
    pathname.startsWith(dmsPathPrefix(tenantId, "signatures")) ||
    pathname.startsWith(dmsPathPrefix(tenantId, "signed")) ||
    pathname.startsWith(brandPathPrefix(tenantId)) ||
    pathname.startsWith(sitePhotoPathPrefix(tenantId))
  );
}
