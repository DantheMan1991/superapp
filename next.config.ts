import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Module dossiers are read from disk at request time by /admin/docs;
  // make sure they're traced into the serverless bundle on deploy.
  outputFileTracingIncludes: {
    "/admin/docs": ["./docs/modules/**/*"],
    "/admin/docs/[slug]": ["./docs/modules/**/*"],
  },
  experimental: {
    // Bank CSV imports travel as text through a server action (preview +
    // import). Server-side caps: 1M chars / 10k rows.
    serverActions: { bodySizeLimit: "4mb" },
  },
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
