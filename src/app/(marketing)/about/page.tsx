import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Blocks, ScanFace, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IMAGES, SITE, TEAM } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why Yosher exists: small businesses grow into an administrative load that forces them to hire an office. We built the office instead.",
};

/**
 * Everything asserted on this page is something the product actually does or
 * is deliberately built to do — the empty-slot discipline, config over forked
 * code, tenant isolation, sending from the client's own domain. Keep it that
 * way. Claims that outrun the build are the fastest way to make the whole page
 * untrustworthy, and this is the page people read when they are deciding
 * whether to believe you.
 */

const PRINCIPLES = [
  {
    icon: Blocks,
    title: "You switch on what you need, and nothing else",
    body: "Every tool is a slot. It stays dark until it earns its place in your business, and you can see exactly what you're paying for. No bundle, no seats you forgot to cancel, no module you use twice a year.",
  },
  {
    icon: ScanFace,
    title: "Your business is not a template",
    body: "Two companies in the same trade run differently, and software that ignores that gets abandoned. Yosher adapts through configuration, not through a fork of the product that quietly rots — so your setup keeps getting every improvement we ship.",
  },
  {
    icon: ShieldCheck,
    title: "Your data is yours, and it's fenced off",
    body: "Every business on the platform is isolated at the database level, not by a filter someone might forget to write. Client work sends from your domain and your name — we're the machinery behind it, not the brand on it.",
  },
  {
    icon: Sparkles,
    title: "Automate the volume, never the judgment",
    body: "Categorizing a hundred transactions is volume. Deciding how to structure a contract is judgment. We're aggressive about the first and deliberately conservative about the second.",
  },
];

export default function AboutPage() {
  return (
    <>
      {/* Intro ----------------------------------------------------------- */}
      <section className="relative overflow-hidden border-b">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-[radial-gradient(50%_60%_at_50%_0%,var(--accent)_0%,transparent_70%)] opacity-60"
        />
        <div className="mx-auto w-full max-w-3xl px-6 py-20 text-center sm:py-24">
          <p className="mx-auto mb-5 w-fit rounded-full border bg-background/70 px-3.5 py-1.5 text-xs font-medium text-accent-foreground shadow-sm">
            About {SITE.name}
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Growing shouldn&apos;t mean hiring an office.
          </h1>
          <p className="mt-6 text-lg text-pretty text-muted-foreground">
            Every business that gets good at its work eventually hits the same
            wall — not a shortage of customers, but the administrative weight
            that comes with them. Yosher exists to take that weight.
          </p>
        </div>
      </section>

      {/* Story ----------------------------------------------------------- */}
      <section className="border-b">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="overflow-hidden rounded-xl border bg-muted shadow-lg">
              {/* Swap public/marketing/about-story.png for a real photo —
                  see public/marketing/README.md. */}
              <Image
                src={IMAGES.aboutStory.src}
                alt={IMAGES.aboutStory.alt}
                width={IMAGES.aboutStory.width}
                height={IMAGES.aboutStory.height}
                sizes="(max-width: 1024px) 100vw, 560px"
                className="h-auto w-full"
              />
            </div>

            <div className="max-w-xl">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                The problem
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                The paperwork grows faster than the work.
              </h2>
              <div className="mt-6 space-y-4 text-muted-foreground">
                <p>
                  Doubling the work rarely means doubling the invoices. It means
                  more quotes, more change orders, more receipts, more chasing,
                  more scheduling, more of everything that happens after the
                  real job is finished. Most owners absorb it personally, at
                  night, until they can&apos;t — and then they hire.
                </p>
                <p>
                  Hiring works, but it&apos;s expensive and slow, and it turns a
                  business that was good at its craft into a business that also
                  has to be good at managing an office. That trade catches a lot
                  of people by surprise.
                </p>
                <p>
                  So we built the office instead. Software handles the volume —
                  the books, the invoicing, the contract paperwork, the
                  follow-up that never ends. What&apos;s left is the small pile
                  of decisions that actually need a person, and that person is
                  still you.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Principles ------------------------------------------------------ */}
      <section className="border-b bg-muted/40">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              What we hold to
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Four decisions that shape everything we build.
            </h2>
          </div>
          <div className="mt-12 grid gap-10 sm:grid-cols-2 sm:gap-x-12">
            {PRINCIPLES.map((principle) => (
              <div key={principle.title}>
                <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <principle.icon className="size-5" />
                </div>
                <h3 className="font-medium text-pretty">{principle.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {principle.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team — renders only once someone is added to TEAM in src/lib/site.ts */}
      {TEAM.length > 0 && (
        <section className="border-b">
          <div className="mx-auto w-full max-w-6xl px-6 py-20">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Who you&apos;re working with
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                The team
              </h2>
            </div>
            <ul className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
              {TEAM.map((member) => (
                <li key={member.name}>
                  {member.image ? (
                    <Image
                      src={member.image.src}
                      alt={member.image.alt}
                      width={member.image.width}
                      height={member.image.height}
                      sizes="(max-width: 640px) 100vw, 320px"
                      className="aspect-square w-full rounded-xl border object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden
                      className="flex aspect-square w-full items-center justify-center rounded-xl border bg-muted text-4xl font-semibold text-muted-foreground"
                    >
                      {member.name.charAt(0)}
                    </div>
                  )}
                  <h3 className="mt-4 font-medium">{member.name}</h3>
                  <p className="text-sm text-brand-foreground">{member.role}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {member.bio}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* CTA ------------------------------------------------------------- */}
      <section>
        <div className="mx-auto w-full max-w-3xl px-6 py-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            The fastest way to see if this fits.
          </h2>
          <p className="mt-5 text-pretty text-muted-foreground">
            Take the free health check. Ten questions, a written diagnosis of
            where your time and money are going, and no obligation to do
            anything about it with us.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="h-11 px-6 text-base">
              <Link href="/health-check">
                Start your free health check <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 px-6 text-base"
            >
              <Link href="/contact">Talk to us instead</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
