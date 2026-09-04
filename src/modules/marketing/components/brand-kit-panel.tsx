import type { BrandKit } from "@/db/schema";
import type { ResolvedBrand } from "@/lib/brand/core";
import { Panel } from "@/components/app/panel";
import { BrandKitForm } from "./brand-kit-form";
import { BrandPreview } from "./brand-preview";
import { LogoControls } from "./logo-controls";

/**
 * One kit, drawn as: how it reads → the logo → the fields. Server component;
 * the two interactive halves are client components beneath it.
 *
 * `kit` is null when nothing has been saved yet, which is every new tenant.
 * The screen still renders — preview from the fallbacks, empty fields — and
 * the first save creates the row.
 */
export function BrandKitPanel({
  tenantId,
  entityId,
  kit,
  resolved,
  fallbackName,
  canWrite,
}: {
  tenantId: string;
  entityId: string | null;
  kit: BrandKit | null;
  resolved: ResolvedBrand;
  /** What the name field falls back to when left blank. */
  fallbackName: string;
  canWrite: boolean;
}) {
  const ownLogo = kit?.logoPathname
    ? {
        kitId: kit.id,
        width: kit.logoWidth,
        height: kit.logoHeight,
        mimeType: kit.logoMimeType,
        version: kit.updatedAt.getTime(),
      }
    : null;
  // A company panel with no logo of its own still SHOWS the shared one in its
  // preview, and says so, so the owner can see why the invoice carries it.
  const inheritedLogo =
    !ownLogo && resolved.logo && entityId !== null
      ? "Using your brand's logo."
      : null;

  return (
    <Panel className="divide-y divide-divider">
      <div className="p-5">
        <BrandPreview
          resolved={resolved}
          logoSrc={
            ownLogo
              ? logoSrc(ownLogo.kitId, ownLogo.version)
              : resolved.logo && entityId !== null
                ? null
                : null
          }
          inheritedLogoNote={inheritedLogo}
        />
      </div>
      <div className="p-5">
        <LogoControls
          tenantId={tenantId}
          entityId={entityId}
          logo={ownLogo ? { ...ownLogo, src: logoSrc(ownLogo.kitId, ownLogo.version) } : null}
          canWrite={canWrite}
        />
      </div>
      <div className="p-5">
        <BrandKitForm
          entityId={entityId}
          initial={{
            displayName: kit?.displayName ?? "",
            tagline: kit?.tagline ?? "",
            primaryColor: kit?.primaryColor ?? "",
            accentColor: kit?.accentColor ?? "",
          }}
          fallbackName={fallbackName}
          canWrite={canWrite}
        />
      </div>
    </Panel>
  );
}

/**
 * The signed-in logo route, cache-busted by the row's last change so a
 * replaced logo shows at once. The route re-reads the row through RLS on every
 * fetch; the id alone grants nothing.
 */
function logoSrc(kitId: string, version: number): string {
  return `/api/marketing/brand/${kitId}/logo?v=${version}`;
}
