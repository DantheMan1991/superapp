import Image from "next/image";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import {
  ArrowRight,
  ClipboardCheck,
  FileCheck2,
  Landmark,
  Layers,
  Megaphone,
  Plug,
  Route,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IMAGES } from "@/lib/site";

const PILLARS = [
  {
    icon: Route,
    title: "The work, tracked end to end",
    body: "Jobs and orders from the first call to the final sign-off — scheduled, assigned, and visible while they're happening, not reconstructed from memory on Sunday night.",
  },
  {
    icon: Landmark,
    title: "Books that stay clean",
    body: "Every transaction categorized, invoices out the door, and unpaid bills chased automatically — so your books are always current and ready to close.",
  },
  {
    icon: FileCheck2,
    title: "Paperwork that keeps up",
    body: "Quotes, contracts and change orders from proven templates, with every key date tracked so nothing slips through.",
  },
  {
    icon: Megaphone,
    title: "A pipeline that never goes quiet",
    body: "Content, review requests, and lead follow-up handled automatically — so the next job is already lined up.",
  },
];

/**
 * The three layers are the differentiator, and the wording is load-bearing.
 * `src/lib/discovery.ts` treats a prospect who wants one-off bespoke software
 * as a bad fit — so this describes layers on a maintained platform, and never
 * promises code that belongs to one client and rots when they stop paying.
 */
const LAYERS = [
  {
    label: "The core",
    title: "What every business needs",
    body: "Books, documents, invoicing, follow-up. Built once and maintained properly, so you are never the only person keeping them alive — and every improvement we ship reaches you.",
  },
  {
    label: "Your industry",
    title: "What your kind of work needs",
    body: "On top of the core, the tools your trade actually runs on. They exist because a business like yours needed them, which means you inherit work already paid for and already proven.",
  },
  {
    label: "Your business",
    title: "The way you specifically do it",
    body: "Then the layer that is only yours — your workflow, your terminology, your way of quoting and scheduling and closing out. If the thing you need doesn't exist yet, we build it.",
  },
];

const STEPS = [
  {
    icon: ClipboardCheck,
    title: "We learn how you actually run",
    body: "Start with the free health check. Questions about the work, your people and the paperwork — wherever the work happens — and you get a written picture of where the hours and the money are going.",
  },
  {
    icon: Plug,
    title: "You switch on what you need",
    body: "Every tool is a slot you turn on when it earns its place. Nothing you don't use, and no bundle you're paying for out of habit.",
  },
  {
    icon: Workflow,
    title: "We fit the last part to you",
    body: "Your layer gets shaped around your workflow, and anything genuinely missing gets built. Then the volume work runs itself and you get your evenings back.",
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
            Software shaped around how your business actually runs — on the job
            site, on the floor, in the dining room, and in the paperwork that
            follows. It handles the volume. When judgment matters, a real
            professional reviews and signs off. You stay on the work only you
            can do.
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
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              From the first call to the money in the bank.
            </h2>
            <p className="mt-4 text-pretty text-muted-foreground">
              Not just the back office. Yosher covers the whole run of a job —
              what your people are doing today, what it costs, what got
              promised, and what has to happen next.
            </p>
          </div>
          <div className="mt-12 grid gap-10 sm:grid-cols-2 md:gap-8 lg:grid-cols-4">
            {PILLARS.map((pillar) => (
              <div key={pillar.title}>
                <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <pillar.icon className="size-5" />
                </div>
                <h3 className="font-medium text-pretty">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {pillar.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Three layers ---------------------------------------------------- */}
      <section className="border-t">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Built for you, not for everyone
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Off-the-shelf software makes you work its way. This works yours.
            </h2>
            <p className="mt-4 text-pretty text-muted-foreground">
              Two companies in the same trade don&apos;t run the same way, and
              software that pretends otherwise is the software that ends up
              abandoned next to a spreadsheet. Yosher is built in three layers.
            </p>
          </div>

          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {LAYERS.map((layer, i) => (
              <li
                key={layer.label}
                className="relative flex flex-col rounded-xl border bg-card p-6 shadow-sm"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Layers className="size-4" />
                  </span>
                  <span className="text-xs font-semibold tracking-wide text-brand-foreground uppercase">
                    {layer.label}
                  </span>
                </div>
                <h3 className="mt-4 font-medium text-pretty">{layer.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {layer.body}
                </p>
                <span
                  aria-hidden
                  className="mt-5 block h-1 rounded-full bg-primary/15"
                  style={{ width: `${40 + i * 30}%` }}
                />
              </li>
            ))}
          </ol>

          <p className="mt-8 max-w-2xl text-sm text-pretty text-muted-foreground">
            The difference that matters: your layer sits on a platform we keep
            maintained. You get software fitted to your business without owning
            a one-off system that nobody updates once the developer moves on.
          </p>
        </div>
      </section>

      {/* How it works ---------------------------------------------------- */}
      <section className="border-t bg-muted/40">
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
      <section className="border-t">
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
      <section className="border-t bg-muted/40">
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
