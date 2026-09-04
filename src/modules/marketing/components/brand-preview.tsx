import { foregroundOn, type ResolvedBrand } from "@/lib/brand/core";

/**
 * How the kit reads — a letterhead strip, the way the top of the invoice
 * reads. No controls; the panel below it has those.
 *
 * `logoSrc` is null when the logo on show is not this kit's own (a company
 * inheriting the business logo has nothing of its own to fetch); the note says
 * so instead, which is more honest than fetching the parent's file under a
 * different heading.
 */
export function BrandPreview({
  resolved,
  logoSrc,
  inheritedLogoNote,
}: {
  resolved: ResolvedBrand;
  logoSrc: string | null;
  inheritedLogoNote: string | null;
}) {
  const primary = resolved.primaryColor ?? "#111827";
  const monogram = resolved.displayName.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex flex-wrap items-center justify-between gap-6">
      <div className="flex min-w-0 items-center gap-4">
        {logoSrc ? (
          // A plain <img>: the source is our own signed-in route, sized by the
          // row's stored dimensions, and next/image would add an optimizer hop
          // in front of a private file for nothing.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoSrc}
            alt=""
            className="max-h-14 w-auto max-w-40 object-contain"
          />
        ) : (
          <div
            className="flex size-14 shrink-0 items-center justify-center rounded-xl text-2xl font-semibold"
            style={{
              backgroundColor: resolved.primaryColor ?? "var(--muted)",
              color: resolved.primaryColor
                ? foregroundOn(resolved.primaryColor)
                : "var(--muted-foreground)",
            }}
            aria-hidden
          >
            {monogram}
          </div>
        )}
        <div className="min-w-0">
          <div
            className="truncate font-heading text-xl font-semibold tracking-heading"
            style={{ color: primary }}
          >
            {resolved.displayName}
          </div>
          {resolved.tagline ? (
            <div className="truncate text-sm text-muted-foreground">
              {resolved.tagline}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground/70">No tagline yet</div>
          )}
          {inheritedLogoNote && (
            <div className="mt-1 text-xs text-muted-foreground">{inheritedLogoNote}</div>
          )}
        </div>
      </div>
      <dl className="flex gap-4 text-xs">
        <Swatch label="Primary" hex={resolved.primaryColor} />
        <Swatch label="Accent" hex={resolved.accentColor} />
      </dl>
    </div>
  );
}

function Swatch({ label, hex }: { label: string; hex: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="size-8 rounded-lg ring-1 ring-foreground/10"
        style={{ backgroundColor: hex ?? "var(--muted)" }}
        aria-hidden
      />
      <div>
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="font-mono">{hex ?? "Default"}</dd>
      </div>
    </div>
  );
}
