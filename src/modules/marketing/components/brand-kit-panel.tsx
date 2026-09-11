import type { BrandKit } from "@/db/schema";
import type { ResolvedBrand } from "@/lib/brand/core";
import { Panel } from "@/components/app/panel";
import { BrandKitForm } from "./brand-kit-form";
import { BrandPreview } from "./brand-preview";
import { LogoControls } from "./logo-controls";
import type { LookInherits } from "./look-fields";
import type { KitOwner } from "@/lib/brand/owner";

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
  owner,
  kit,
  resolved,
  inherits,
  fallbackName,
  canWrite,
}: {
  tenantId: string;
  owner: KitOwner;
  kit: BrandKit | null;
  resolved: ResolvedBrand;
  /** What an owned kit's blank look falls back to (the business kit's answers); null on the business kit itself. */
  inherits: LookInherits | null;
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
        source: kit.logoSource === "generated" ? ("generated" as const) : ("upload" as const),
        version: kit.updatedAt.getTime(),
      }
    : null;
  // A company's or a website's panel with no logo of its own still SHOWS the
  // shared one in its preview, and says so, so the owner can see why the
  // invoice — or the site header — carries it.
  const inheritedLogo =
    !ownLogo && resolved.logo && owner.kind !== "business"
      ? "Using your brand's logo."
      : null;

  return (
    <Panel className="divide-y divide-divider">
      <div className="p-5">
        <BrandPreview
          resolved={resolved}
          logoSrc={ownLogo ? logoSrc(ownLogo.kitId, ownLogo.version) : null}
          inheritedLogoNote={inheritedLogo}
        />
      </div>
      <div className="p-5">
        <LogoControls
          tenantId={tenantId}
          owner={owner}
          logo={ownLogo ? { ...ownLogo, src: logoSrc(ownLogo.kitId, ownLogo.version) } : null}
          nameForLogo={kit?.displayName || fallbackName}
          canWrite={canWrite}
        />
      </div>
      <div className="p-5">
        <BrandKitForm
          owner={owner}
          initial={{
            displayName: kit?.displayName ?? "",
            tagline: kit?.tagline ?? "",
            primaryColor: kit?.primaryColor ?? "",
            accentColor: kit?.accentColor ?? "",
            look: kit?.look ?? "",
            fontPairing: kit?.fontPairing ?? "",
            buttonShape: kit?.buttonShape ?? "",
          }}
          inherits={inherits}
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
