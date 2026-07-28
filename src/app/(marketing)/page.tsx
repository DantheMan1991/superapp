import Image from "next/image";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import {
  ArrowRight,
  ClipboardCheck,
  FileCheck2,
  Landmark,
  Megaphone,
  Plug,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IMAGES } from "@/lib/site";

const PILLARS = [
  {
    icon: Landmark,
    title: "Books that stay clean",
    body: "Every transaction categorized, invoices out the door, and unpaid bills chased automatically — so your books are always current and ready to close.",
  },
  {
    icon: FileCheck2,
    title: "Contracts, done right",
    body: "Generate contracts and change orders from proven templates, with every key date tracked so nothing slips through.",
  },
  {
    icon: Megaphone,
    title: "A pipeline that never goes quiet",
    body: "Content, review requests, and lead follow-up handled automatically — so the next job is already lined up.",
  },
];

const STEPS = [
  {
    icon: ClipboardCheck,
    title: "We look at how you actually run",
    body: "Start with the free health check. Ten questions about the work, the crew and the paperwork, and you get a written picture of where the hours and the money are going.",
  },
  {
    icon: Plug,
    title: "You switch on what you need",
    body: "Every tool is a slot you turn on when it earns its place. Nothing you don't use, and no bundle you're paying for out of habit.",
  },
  {
    icon: Workflow,
    title: "The admin stops being your evening",
    body: "The volume work runs itself in the background. What's left is the handful of decisions that genuinely need you.",
  },
];

export default async function LandingPage() {
  const { userId } = await auth();

  return (
    <>
      {/* Hero ------------------------------------------------------------ */}
      <section className="relative overflow-hidden">
        {/* Soft brand wash behind the hero; purely decorative. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(60%_60%_at_50%_0%,var(--accent)_0%,transparent_70%)] opacity-70"
        />

        <div className="mx-auto w-full max-w-6xl px-6 pt-20 pb-16 text-center sm:pt-28">
          <p className="mx-auto mb-5 w-fit rounded-full border bg-background/70 px-3.5 py-1.5 text-xs font-medium text-accent-foreground shadow-sm">
            The outsourced business office
          </p>
          <h1 className="mx-auto max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Grow without building an office.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl">
            Custom software handles the administrative volume — books,
            invoicing, contracts, follow-up. When judgment matters, a real
            professional reviews and signs off. You stay focused on the work
            only you can do.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="h-11 w-full px-6 text-base sm:w-auto"
            >
              <Link href={userId ? "/dashboard" : "/sign-up"}>
                {userId ? "Open dashboard" : "Get started"}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 w-full px-6 text-base sm:w-auto"
            >
              <Link href="/health-check">Get your free health check</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            No signup, no card, no sales script.
          </p>
        </div>

        {/* Product shot. Swap public/marketing/hero.png for a real
            screenshot — see public/marketing/README.md. */}
        <div className="mx-auto w-full max-w-6xl px-6 pb-20 sm:pb-28">
          <div className="overflow-hidden rounded-xl border bg-card shadow-2xl shadow-primary/10 ring-1 ring-black/5">
            <Image
              src={IMAGES.hero.src}
              alt={IMAGES.hero.alt}
              width={IMAGES.hero.width}
              height={IMAGES.hero.height}
              priority
              sizes="(max-width: 1152px) 100vw, 1152px"
              className="h-auto w-full"
            />
          </div>
        </div>
      </section>

      {/* Pillars --------------------------------------------------------- */}
      <section className="border-t bg-muted/40">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            The work that piles up after the job is done.
          </h2>
          <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
            {PILLARS.map((pillar) => (
              <div key={pillar.title}>
                <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <pillar.icon className="size-5" />
                </div>
                <h3 className="font-medium">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {pillar.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works ---------------------------------------------------- */}
      <section className="border-t">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              How it works
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Start where it hurts. Add the rest when it pays for itself.
            </h2>
          </div>
          <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <div className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-background text-sm font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  <step.icon className="size-5 text-muted-foreground" />
                </div>
                <h3 className="mt-4 font-medium">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Health check ---------------------------------------------------- */}
      <section className="border-t bg-muted/40">
        <div className="mx-auto w-full max-w-3xl px-6 py-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Find out where your business is bleeding time and money — free.
          </h2>
          <p className="mt-5 text-pretty text-muted-foreground">
            Answer about ten quick questions from our AI interviewer — about the
            work, the crew, the paperwork, all of it — and get a plain-language
            health check of your business: what&apos;s costing you hours every
            week, what it adds up to in dollars, and what to fix first. No
            signup, no card, no sales script.
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

      {/* Judgment -------------------------------------------------------- */}
      <section className="border-t">
        <div className="mx-auto w-full max-w-3xl px-6 py-20 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Software does the volume. You keep the judgment.
          </h2>
          {/* Stage-accurate wording per the brand doc: describes the
              professional-review layer as the direction being built toward.
              Do not claim live accountant/attorney review until those
              professionals are under contract. */}
          <p className="mt-5 text-pretty text-muted-foreground">
            Yosher automates the administrative work that eats your evenings —
            but it never pretends to replace real expertise. As your business
            grows, Yosher brings in licensed professionals to review and sign
            off on what matters: an accountant to close your books, an attorney
            for the contracts that carry risk. You&apos;re never trusting a
            machine with the decisions that count.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="outline" className="h-10 px-5">
              <Link href="/about">Why we built this</Link>
            </Button>
            <Button asChild variant="ghost" className="h-10 px-5">
              <Link href="/contact">
                Talk to us <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
