import "server-only";
import type { Tx } from "@/db";
import type { HexColor } from "@/lib/brand/core";
import { loadLogoBytes, resolveBrandFor } from "@/lib/brand/read";
import type { InvoicePdfBrand } from "./invoice-pdf-model";

/**
 * What the invoice carries of the brand kit, in two steps that match the
 * house rule about transactions: the ROW is read inside the caller's
 * `withTenant` (database only), and the logo's BYTES are fetched afterwards
 * (network, never inside a transaction).
 *
 * Accounting learns nothing about Marketing here. `src/lib/brand/` is Layer 0,
 * the way `src/lib/money` and `src/lib/work` are, and the invoice reads the
 * business's identity from it the way it reads the tenant's timezone.
 */
export interface InvoiceBrandRow {
  /** The name on the document: the kit's display name, else the tenant's. */
  businessName: string;
  tagline: string;
  primaryColor: HexColor | null;
  logo: {
    pathname: string;
    mimeType: string;
    width: number;
    height: number;
  } | null;
}

export async function loadInvoiceBrand(
  tx: Tx,
  tenantId: string,
  entityId: string | null,
): Promise<InvoiceBrandRow> {
  const brand = await resolveBrandFor(tx, tenantId, entityId);
  return {
    businessName: brand.displayName,
    tagline: brand.tagline,
    primaryColor: brand.primaryColor,
    logo: brand.logo
      ? {
          pathname: brand.logo.pathname,
          mimeType: brand.logo.mimeType,
          width: brand.logo.width,
          height: brand.logo.height,
        }
      : null,
  };
}

/**
 * The renderer's half. A logo whose blob is gone renders as no logo — a
 * missing file must never fail an invoice, or a reminder sweep. `cache` lets
 * the reminder sweep fetch a tenant's logo once rather than per invoice.
 */
export async function withLogoBytes(
  brand: InvoiceBrandRow,
  cache?: Map<string, Uint8Array | null>,
): Promise<InvoicePdfBrand> {
  let logo: InvoicePdfBrand["logo"] = null;
  if (brand.logo) {
    const { pathname } = brand.logo;
    let data = cache?.get(pathname);
    if (data === undefined) {
      data = await loadLogoBytes(pathname);
      cache?.set(pathname, data);
    }
    if (data) {
      logo = {
        data,
        width: brand.logo.width,
        height: brand.logo.height,
        // The kit stores what the bytes said they were; react-pdf wants it
        // as its own two-value enum.
        format: brand.logo.mimeType === "image/jpeg" ? "jpg" : "png",
      };
    }
  }
  return { tagline: brand.tagline, primaryColor: brand.primaryColor, logo };
}
