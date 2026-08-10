import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Module dossiers are read from disk at request time by /admin/docs;
  // make sure they're traced into the serverless bundle on deploy.
  outputFileTracingIncludes: {
    "/admin/docs": ["./docs/modules/**/*"],
    "/admin/docs/[slug]": ["./docs/modules/**/*"],
    // Document generation reads the Noto Sans TTFs off disk and registers them
    // with @react-pdf/renderer as buffers. Without this the fonts are absent in
    // the serverless bundle and generation fails at request time — a failure
    // that cannot reproduce locally, where the repo is simply there.
    // The TTFs moved to src/lib/pdf/fonts when Accounting started generating
    // invoice PDFs too — a module may not import another module.
    "/dashboard/m/documents/templates/[templateId]": ["./src/lib/pdf/fonts/**/*"],
    "/api/accounting/invoices/[id]/pdf": ["./src/lib/pdf/fonts/**/*"],
  },
  experimental: {
    // Bank CSV imports travel as text through a server action (preview +
    // import). Server-side caps: 1M chars / 10k rows.
    serverActions: { bodySizeLimit: "4mb" },
  },
  // Development only. Local mail work has to run on the loopback IP rather than
  // "localhost", because Stalwart rejects a hostname OAuth redirect URI — RFC
  // 8252 §7.3 wants a loopback IP literal, since a hostname can be repointed by
  // DNS or a hosts file and the redirect URI is where an auth code lands.
  // Without this, Next blocks HMR at http://127.0.0.1:3000.
  //
  // LIST BOTH. This option REPLACES the implicit allowlist rather than adding
  // to it, so `["127.0.0.1"]` alone drops "localhost" — and the failure is not
  // an origin error, it is `/sign-in` and `/sign-up` returning 404 while every
  // other route keeps working. Half an hour of looking in the wrong place.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  async redirects() {
    // Muscle-memory aliases for the auth pages.
    return [
      { source: "/login", destination: "/sign-in", permanent: false },
      { source: "/signin", destination: "/sign-in", permanent: false },
      { source: "/signup", destination: "/sign-up", permanent: false },
      { source: "/register", destination: "/sign-up", permanent: false },
    ];
  },
};

export default nextConfig;
