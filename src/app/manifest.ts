import type { MetadataRoute } from "next";

/**
 * The install manifest: what lets a phone put Yosher on its home screen as a
 * standalone app, and what Android's Trusted Web Activity route into the
 * Play Store reads. The native shell (ADR 0032) does not need it, but a
 * client who never installs the app gets most of the app this way for free.
 *
 * Served at /manifest.webmanifest. The proxy's matcher already leaves that
 * extension alone, so no session work runs for it. The colours are the
 * page's off-white and the sidebar's navy, in hex because a manifest cannot
 * read the stylesheet.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Yosher",
    short_name: "Yosher",
    description: "Your business office, in one place.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#fbfaf7",
    theme_color: "#13203e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
