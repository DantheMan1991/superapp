import type { NextConfig } from "next";

/**
 * The native halves of `sharp` on the runtime Vercel actually runs.
 *
 * Only linux-x64 is listed on purpose: shipping every platform's binaries would
 * put ~100MB of macOS and Windows libvips into a Linux function for nothing.
 * If deployment ever moves to arm64, this is the line that has to change, and
 * the symptom will be a dlopen failure that says so.
 */
const SHARP_NATIVE = [
  "./node_modules/@img/sharp-linux-x64/**/*",
  "./node_modules/@img/sharp-libvips-linux-x64/**/*",
];

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
    // **sharp's libvips IS AN ELF DEPENDENCY, AND FILE TRACING CANNOT SEE IT.**
    //
    // `sharp` is already on Next's default external list, so it is not bundled
    // — the tracer follows it into node_modules and copies what JS requires.
    // `@img/sharp-linux-x64` is required that way and arrives. The shared
    // library it links against, `@img/sharp-libvips-linux-x64`, is required by
    // NOTHING in JavaScript: the `.node` binary names it at the ELF level and
    // the loader resolves it at dlopen time. Nothing in the module graph
    // mentions it, so nothing traces it, so it is absent on the deployed
    // function and the load fails with:
    //
    //   ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object file
    //
    // Same shape as the fonts above and it fails the same way — invisibly in
    // production and never locally, where node_modules is simply there. It is
    // worse than the fonts here, because this machine is Windows: the linux-x64
    // packages are not even INSTALLED locally, so there is no version of
    // running the app on this laptop that could have caught it.
    //
    // **A NEW ROUTE THAT PROCESSES AN IMAGE MUST ADD ITSELF TO THIS LIST.**
    // These four are everything that reaches `ai/extract.ts` today: the inbound
    // email hook, the receipts inbox and its detail page, and the document
    // browser. Both packages are named rather than only libvips, because a
    // trace that gets one and not the other is exactly the failure being fixed.
    "/api/inbound/resend": SHARP_NATIVE,
    "/dashboard/m/accounting/receipts": SHARP_NATIVE,
    "/dashboard/m/accounting/receipts/[id]": SHARP_NATIVE,
    "/dashboard/m/documents/browse": SHARP_NATIVE,
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
