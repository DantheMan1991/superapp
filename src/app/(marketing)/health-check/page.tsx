import type { Metadata } from "next";
import { HealthCheckChat } from "./health-check-chat";

export const metadata: Metadata = {
  title: "Free Business Health Check",
  description:
    "Answer about ten quick questions and get a plain-language health check of your business: where you're losing time and money, and what to fix first.",
};

/**
 * PUBLIC page — no auth. All protection lives in the server actions.
 *
 * Header and footer come from the (marketing) layout; this page owns only its
 * own content.
 */
export default function HealthCheckPage() {
  return (
    <div className="bg-muted/40 px-6 py-12">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Free Business Health Check
          </h1>
          <p className="mt-3 text-pretty text-muted-foreground">
            Ten quick questions about how your business actually runs. A written
            diagnosis at the end — yours to keep either way.
          </p>
        </div>
        <HealthCheckChat />
      </div>
    </div>
  );
}
