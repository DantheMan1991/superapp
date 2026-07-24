import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HealthCheckChat } from "./health-check-chat";

export const metadata: Metadata = {
  title: "Free Business Health Check — Yosher",
  description:
    "Answer about ten quick questions and get a plain-language health check of your business: where you're losing time and money, and what to fix first.",
};

/** PUBLIC page — no auth. All protection lives in the server actions. */
export default function HealthCheckPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/yosher-mark.png"
              alt="Yosher"
              width={36}
              height={36}
              priority
              className="rounded-md"
            />
            <span className="text-lg font-semibold">Yosher</span>
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 bg-muted/40 px-6 py-10">
        <div className="mx-auto w-full max-w-5xl space-y-8">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              Free Business Health Check
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ten quick questions about how your business actually runs. A
              written diagnosis at the end — yours to keep either way.
            </p>
          </div>
          <HealthCheckChat />
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Yosher</span>
          <Link href="/" className="hover:text-foreground">
            yosherapp.com
          </Link>
        </div>
      </footer>
    </div>
  );
}
