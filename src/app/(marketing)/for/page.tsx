import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listVerticals } from "@/lib/verticals";
import { SITE } from "@/lib/site";

/**
 * The industries we serve.
 *
 * Every card is a row of the registry (`src/lib/verticals/`), so this page can
 * never fall out of step with the pages it links to — the failure mode of a
 * hand-written list, and the reason there isn't one.
 *
 * The honesty panel at the bottom is load-bearing while the list is short. A
 * page listing one industry either reads as early and open, or as a site that
 * forgot to finish; saying which industries exist and inviting the rest is
 * what makes it the first.
 */

// The root layout appends ` · Yosher`, so this must not say it too.
const TITLE = "The industries we serve";
const DESCRIPTION =
  "The industries Yosher is built around, and what each one gets on top of the core. Don't see yours? The core runs any business — tell us what you run.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE.url}/for` },
  openGraph: {
    type: "website",
    url: `${SITE.url}/for`,
    title: TITLE,
    description: DESCRIPTION,
    siteName: SITE.name,
  },
};

export default function VerticalsIndexPage() {
  const verticals = listVerticals();

  return (
    <>
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[30rem] bg-[radial-gradient(60%_60%_at_50%_0%,var(--accent)_0%,transparent_70%)] opacity-70"
        />
        <div className="mx-auto w-full max-w-3xl px-6 pt-20 pb-14 text-center sm:pt-24">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Built around how your industry works.
          </h1>
          <p className="mt-6 text-lg text-pretty text-muted-foreground">
            Every business needs books, documents, invoicing and follow-up — so
            that&apos;s the core, and it&apos;s the same for everyone. What sits
            on top is the part that knows your trade: its records, its words,
            its way of getting paid.
          </p>
        </div>
      </section>

      <section className="border-t bg-muted/40">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="grid gap-6 md:grid-cols-2">
            {verticals.map((vertical) => (
              <Link
                key={vertical.slug}
                href={`/for/${vertical.slug}`}
                className="group flex flex-col rounded-xl border bg-card p-7 shadow-sm transition-shadow outline-none hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <div className="mb-5 flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <vertical.card.icon className="size-5" />
                </div>
                <h2 className="text-lg font-medium">{vertical.card.heading}</h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {vertical.card.body}
                </p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-foreground">
                  {vertical.name}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}

            {/* Not a card in the registry: an industry with no page yet is not
                an industry with a blank page. */}
            <div className="flex flex-col justify-center rounded-xl border border-dashed bg-background p-7">
              <h2 className="text-lg font-medium">Not your trade?</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Yosher is early and the list is short on purpose — an industry
                gets a page once the tools behind it are real, not before. The
                core runs any business today, and the industry layer gets built
                for whoever needs it first.
              </p>
              <div className="mt-5">
                <Button asChild variant="outline" className="h-10 px-5">
                  <Link href="/health-check">
                    Tell us what you run <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto w-full max-w-3xl px-6 py-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Start with the free health check.
          </h2>
          <p className="mt-5 text-pretty text-muted-foreground">
            About ten questions on how your business actually runs — whatever it
            is. You get a written picture of where the hours and the money are
            going, and we learn whether there&apos;s a layer worth building.
          </p>
          <div className="mt-8">
            <Button asChild size="lg" className="h-11 px-6 text-base">
              <Link href="/health-check">
                Start your free health check <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
